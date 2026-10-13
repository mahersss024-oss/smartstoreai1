'use client';

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

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
  const [session, setSession] = useState<AuthSessionPayload>(signedOutSession);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    setIsSessionLoading(true);
    const nextSession = await fetchAuthSession();
    setSession(nextSession);
    setIsSessionLoading(false);
    return nextSession;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncSession() {
      const nextSession = await fetchAuthSession();

      if (!cancelled) {
        setSession(nextSession);
        setIsSessionLoading(false);
      }
    }

    void syncSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      isSessionLoading,
      refreshSession,
      session,
      setSession,
    }),
    [isSessionLoading, refreshSession, session],
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
