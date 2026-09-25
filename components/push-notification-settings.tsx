'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

import { Button } from '@ui/button';

type PushConfigResponse = {
  configured: boolean;
  publicKey: string | null;
};

type PushState =
  | 'checking'
  | 'unsupported'
  | 'not_configured'
  | 'blocked'
  | 'inactive'
  | 'active'
  | 'working';

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function detectPushPlatform() {
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(userAgent)) {
    return 'ios';
  }

  if (/android/.test(userAgent)) {
    return 'android';
  }

  return 'web';
}

export function PushNotificationSettings() {
  const [state, setState] = useState<PushState>('checking');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      (window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost')
    );
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!isSupported) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }

    try {
      const response = await fetch('/api/push/subscribe', {
        cache: 'no-store',
      });
      const config = (await response.json()) as PushConfigResponse;

      if (!config.configured || !config.publicKey) {
        setState('not_configured');
        return;
      }

      setPublicKey(config.publicKey);

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      setState(subscription ? 'active' : 'inactive');
    } catch {
      setState('inactive');
    }
  }, [isSupported]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const enableNotifications = useCallback(async () => {
    if (!isSupported || !publicKey) {
      return;
    }

    setState('working');
    setNotice(null);

    try {
      const permission = await Notification.requestPermission();

      if (permission === 'denied') {
        setState('blocked');
        setNotice('تم منع الإشعارات من إعدادات المتصفح.');
        return;
      }

      if (permission !== 'granted') {
        setState('inactive');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        }));

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...subscription.toJSON(),
          platform: detectPushPlatform(),
          locale: navigator.language,
        }),
      });

      if (!response.ok) {
        throw new Error('subscribe_failed');
      }

      setState('active');
      setNotice('تم تفعيل إشعارات الرسائل.');
    } catch {
      setState('inactive');
      setNotice('تعذر تفعيل الإشعارات الآن. حاول مرة أخرى.');
    }
  }, [isSupported, publicKey]);

  const disableNotifications = useCallback(async () => {
    if (!isSupported) {
      return;
    }

    setState('working');
    setNotice(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
        await subscription.unsubscribe();
      }

      setState('inactive');
      setNotice('تم إيقاف إشعارات هذا الجهاز.');
    } catch {
      setState('active');
      setNotice('تعذر إيقاف الإشعارات الآن.');
    }
  }, [isSupported]);

  const disabled =
    state === 'checking' ||
    state === 'working' ||
    state === 'unsupported' ||
    state === 'not_configured' ||
    state === 'blocked';
  const isActive = state === 'active';
  const buttonText =
    state === 'checking'
      ? 'جاري التحقق...'
      : state === 'working'
        ? 'جاري المعالجة...'
        : isActive
          ? 'إيقاف إشعارات الرسائل'
          : 'تفعيل إشعارات الرسائل';
  const helperText =
    state === 'unsupported'
      ? 'هذا المتصفح لا يدعم إشعارات الويب لهذا الوضع.'
      : state === 'not_configured'
        ? 'إعدادات الإشعارات غير مكتملة في الخادم.'
        : state === 'blocked'
          ? 'الإشعارات محظورة من إعدادات المتصفح.'
          : 'تصل الإشعارات عند وصول رسالة جديدة في محادثاتك.';

  return (
    <section
      id="notifications"
      className="scroll-mt-20 grid gap-3 rounded-md border bg-white p-4 shadow-sm dark:bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
            {isActive ? <Bell className="size-5" /> : <BellOff className="size-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold">إشعارات الرسائل</h2>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              {helperText}
            </p>
          </div>
        </div>
        <Button
          className="rounded-md"
          disabled={disabled}
          onClick={() =>
            void (isActive ? disableNotifications() : enableNotifications())
          }
          type="button"
          variant={isActive ? 'outline' : 'default'}
        >
          {isActive ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {buttonText}
        </Button>
      </div>
      {notice ? (
        <div className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-800 dark:text-blue-100">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
