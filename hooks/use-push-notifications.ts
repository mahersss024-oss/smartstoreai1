'use client';

import { useCallback, useEffect, useState } from 'react';

type PushSupportState =
  | 'unsupported'
  | 'unconfigured'
  | 'default'
  | 'granted'
  | 'denied'
  | 'subscribed';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushSupportState>('default');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!cancelled) {
          setState('unsupported');
        }

        return;
      }

      try {
        const response = await fetch('/api/push/subscribe', {
          headers: { Accept: 'application/json' },
        });
        const data = (await response.json()) as { configured?: boolean };

        if (cancelled) {
          return;
        }

        if (!data.configured) {
          setState('unconfigured');
          return;
        }
      } catch {
        if (!cancelled) {
          setState('unconfigured');
        }

        return;
      }

      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      if (cancelled) {
        return;
      }

      if (existing) {
        setState('subscribed');
      } else {
        setState('default');
      }
    }

    void detect();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (state === 'unsupported' || state === 'unconfigured') {
      return false;
    }

    setIsBusy(true);

    try {
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'default');
        return false;
      }

      const configResponse = await fetch('/api/push/subscribe', {
        headers: { Accept: 'application/json' },
      });
      const config = (await configResponse.json()) as {
        configured?: boolean;
        publicKey?: string;
      };

      if (!config.configured || !config.publicKey) {
        setState('unconfigured');
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      const json = subscription.toJSON();

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          },
          locale: document.documentElement.lang || 'ar',
        }),
      });

      setState('subscribed');
      return true;
    } catch {
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [state]);

  return {
    state,
    isBusy,
    isSupported: state !== 'unsupported',
    isConfigured: state !== 'unconfigured',
    isSubscribed: state === 'subscribed',
    subscribe,
  };
}
