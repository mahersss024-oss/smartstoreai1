'use client';

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { setChatSessionOwner } from '@/lib/chat/session-state';
import { announceAuthSessionChange, subscribeAuthSessionChanges } from '@/lib/auth/session-sync';

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  phoneNumber?: string;
  role?: string;
};

export type AuthSessionPayload = {
  authenticated: boolean;
  commissionAgreementAccepted?: boolean;
  user: AuthUser | null;
};

type AuthSessionContextValue = {
  isSessionLoading: boolean;
  refreshSession: () => Promise<AuthSessionPayload>;
  session: AuthSessionPayload;
  setSession: Dispatch<SetStateAction<AuthSessionPayload>>;
};

const signedOutSession: AuthSessionPayload = {
  authenticated: false,
  commissionAgreementAccepted: false,
  user: null,
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

async function fetchAuthSession(): Promise<AuthSessionPayload> {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });

    if (!response.ok) {
      return signedOutSession;
    }

    const payload = (await response.json()) as AuthSessionPayload;
    return {
      authenticated: Boolean(payload.authenticated && payload.user),
      commissionAgreementAccepted: Boolean(payload.commissionAgreementAccepted),
      user: payload.authenticated ? (payload.user ?? null) : null,
    };
  } catch {
    return signedOutSession;
  }
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<AuthSessionPayload>(signedOutSession);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const requestVersion = useRef(0);
  const lastCommittedOwner = useRef<string | null | undefined>(undefined);
  const chatOwnerId = session.authenticated ? session.user?.id ?? null : null;
  useLayoutEffect(() => {
    setChatSessionOwner(chatOwnerId);
    if (isSessionLoading) return;
    const previousOwner = lastCommittedOwner.current;
    lastCommittedOwner.current = chatOwnerId;
    if (previousOwner !== undefined && previousOwner !== chatOwnerId) announceAuthSessionChange();
  }, [chatOwnerId, isSessionLoading]);

  const invalidateSessionRequests = useCallback(() => {
    requestVersion.current++;
  }, []);

  const setSession = useCallback<Dispatch<SetStateAction<AuthSessionPayload>>>((next) => {
    invalidateSessionRequests();
    setSessionState(next);
    setIsSessionLoading(false);
  }, [invalidateSessionRequests]);

  const syncSession = useCallback(async (hidePrivateContent = false, announcedElsewhere = false) => {
    const version = ++requestVersion.current;
    if (hidePrivateContent) setIsSessionLoading(true);
    const nextSession = await fetchAuthSession();
    // A response started before logout or a newer verification cannot restore stale identity.
    if (version === requestVersion.current) {
      if (announcedElsewhere) lastCommittedOwner.current = nextSession.authenticated ? nextSession.user?.id ?? null : null;
      setSessionState(nextSession);
      setIsSessionLoading(false);
    }
    return nextSession;
  }, []);

  const refreshSession = useCallback(() => syncSession(true), [syncSession]);

  useEffect(() => {
    void syncSession();
    const unsubscribe = subscribeAuthSessionChanges(() => {
      setChatSessionOwner(null);
      setSessionState(signedOutSession);
      void syncSession(true, true);
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncSession();
    };
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      invalidateSessionRequests();
      unsubscribe();
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [invalidateSessionRequests, syncSession]);

  const value = useMemo(
    () => ({
      isSessionLoading,
      refreshSession,
      session,
      setSession,
    }),
    [isSessionLoading, refreshSession, session, setSession],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);

  if (!context) {
    throw new Error('useAuthSession must be used within AuthSessionProvider');
  }

  return context;
}
