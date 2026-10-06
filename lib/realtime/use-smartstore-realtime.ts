'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { scheduleIdleTask } from '@/lib/client-idle-task';
import type { RealtimeEvent, RealtimeEventType } from './events';

type RealtimeResyncReason = 'event' | 'fallback' | 'online' | 'visible';

type UseSmartstoreRealtimeOptions = {
  connectDelayMs?: number;
  enabled?: boolean;
  eventTypes?: RealtimeEventType[];
  fallbackIntervalMs?: number;
  onEvent?: (event: RealtimeEvent) => void;
  onResync?: (context: {
    reason: RealtimeResyncReason;
    event?: RealtimeEvent;
  }) => Promise<void> | void;
};

type RealtimeConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'fallback_polling';

function parseRealtimeEvent(raw: string): RealtimeEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<RealtimeEvent>;

    if (!value || typeof value !== 'object') {
      return null;
    }

    if (typeof value.id !== 'number' || typeof value.type !== 'string') {
      return null;
    }

    return value as RealtimeEvent;
  } catch {
    return null;
  }
}

export function useSmartstoreRealtime({
  connectDelayMs = 0,
  enabled = true,
  eventTypes,
  fallbackIntervalMs = 4000,
  onEvent,
  onResync,
}: UseSmartstoreRealtimeOptions) {
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>('idle');
  const [lastEventId, setLastEventId] = useState<number | null>(null);

  const lastEventIdRef = useRef<number | null>(null);
  const statusRef = useRef<RealtimeConnectionState>('idle');
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);
  const allowedTypesRef = useRef<Set<RealtimeEventType> | null>(
    eventTypes?.length ? new Set(eventTypes) : null,
  );

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const eventTypesKey = useMemo(
    () =>
      eventTypes?.length
        ? [...eventTypes].sort((left, right) => left.localeCompare(right)).join(',')
        : '',
    [eventTypes],
  );

  useEffect(() => {
    allowedTypesRef.current = eventTypes?.length ? new Set(eventTypes) : null;
  }, [eventTypesKey, eventTypes]);

  useEffect(() => {
    statusRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    lastEventIdRef.current = lastEventId;
  }, [lastEventId]);

  useEffect(() => {
    if (!enabled) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setConnectionState('idle');
        }
      });

      return () => {
        cancelled = true;
      };
    }

    let eventSource: EventSource | null = null;
    let disposed = false;
    let fallbackTimerId: number | null = null;
    let cancelDeferredConnect = () => {};
    let resyncInFlight = false;
    let latestEventId: number | null = lastEventIdRef.current;

    const runResync = async (
      reason: RealtimeResyncReason,
      event?: RealtimeEvent,
    ) => {
      if (!onResyncRef.current || resyncInFlight) {
        return;
      }

      resyncInFlight = true;

      try {
        await onResyncRef.current({ reason, event });
      } finally {
        resyncInFlight = false;
      }
    };

    const stopFallbackPolling = () => {
      if (fallbackTimerId === null) {
        return;
      }

      window.clearInterval(fallbackTimerId);
      fallbackTimerId = null;
    };

    const startFallbackPolling = () => {
      if (fallbackTimerId !== null) {
        return;
      }

      setConnectionState('fallback_polling');
      fallbackTimerId = window.setInterval(() => {
        if (!navigator.onLine) {
          return;
        }

        void runResync('fallback');
      }, Math.min(Math.max(fallbackIntervalMs, 3000), 5000));
    };

    const closeConnection = () => {
      if (!eventSource) {
        return;
      }

      eventSource.close();
      eventSource = null;
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      if (typeof EventSource !== 'function') {
        startFallbackPolling();
        return;
      }

      setConnectionState('connecting');
      const params = new URLSearchParams();

      if (typeof latestEventId === 'number') {
        params.set('lastEventId', String(latestEventId));
      }

      const streamUrl = params.size
        ? `/api/realtime/stream?${params.toString()}`
        : '/api/realtime/stream';

      try {
        eventSource = new EventSource(streamUrl, { withCredentials: true });
      } catch {
        startFallbackPolling();
        return;
      }

      eventSource.onopen = () => {
        if (disposed) {
          return;
        }

        setConnectionState('connected');
        stopFallbackPolling();
      };

      eventSource.onerror = () => {
        if (disposed) {
          return;
        }

        startFallbackPolling();
      };

      eventSource.addEventListener('smartstore', (rawEvent) => {
        if (disposed) {
          return;
        }

        const parsedEvent = parseRealtimeEvent((rawEvent as MessageEvent).data);

        if (!parsedEvent) {
          return;
        }

        latestEventId = parsedEvent.id;
        setLastEventId(parsedEvent.id);

        const allowedTypes = allowedTypesRef.current;

        if (allowedTypes && !allowedTypes.has(parsedEvent.type)) {
          return;
        }

        onEventRef.current?.(parsedEvent);
        void runResync('event', parsedEvent);
      });

      eventSource.addEventListener('heartbeat', () => {
        if (disposed) {
          return;
        }

        if (statusRef.current !== 'connected') {
          setConnectionState('connected');
        }

        stopFallbackPolling();
      });
    };

    const reconnect = () => {
      closeConnection();
      connect();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void runResync('visible');

      if (statusRef.current !== 'connected') {
        reconnect();
      }
    };

    const onOnline = () => {
      void runResync('online');
      reconnect();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    if (connectDelayMs > 0) {
      cancelDeferredConnect = scheduleIdleTask(connect, connectDelayMs);
    } else {
      connect();
    }

    return () => {
      disposed = true;
      cancelDeferredConnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      stopFallbackPolling();
      closeConnection();
    };
  }, [connectDelayMs, enabled, fallbackIntervalMs, eventTypesKey]);

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    lastEventId,
  };
}
