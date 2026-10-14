'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

import { Button } from '@ui/button';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import {
  detectAppPlatform,
  isInsideNativeApp,
  postToNative,
} from '@/lib/native/app-bridge';

type PushConfigResponse = {
  configured: boolean;
  publicKey: string | null;
};

type NotificationsSummaryResponse = {
  unreadCount: number;
};

type PushState =
  | 'checking'
  | 'unsupported'
  | 'not_configured'
  | 'blocked'
  | 'inactive'
  | 'active'
  | 'working';

const notificationsReadEventName = 'smartstore:notifications-read';
const notificationsChangedEventName = 'smartstore:notifications-changed';
const nativePushStatusEventName = 'smartstore:native-push-status';
const iconStatusRefreshDelayMs = 45_000;
const iconUnreadRefreshDelayMs = 60_000;

type NativePushStatus = {
  supported?: boolean;
  platform?: 'android' | 'ios' | string;
  permission?: 'granted' | 'denied' | 'default' | string;
  active?: boolean;
};

type NativePushWindow = Window & {
  SouqHamadNativePush?: NativePushStatus;
};

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

function getNativePushStatus(): NativePushStatus | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return (window as NativePushWindow).SouqHamadNativePush ?? null;
}

function isNativePushShell() {
  if (typeof window === 'undefined') {
    return false;
  }

  const platform = detectAppPlatform();
  return isInsideNativeApp() && (platform === 'android' || platform === 'ios');
}

export function PushNotificationSettings({
  variant = 'panel',
}: {
  variant?: 'panel' | 'icon';
}) {
  const [state, setState] = useState<PushState>('checking');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

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
    if (isNativePushShell()) {
      const nativeStatus = getNativePushStatus();

      if (nativeStatus?.permission === 'denied') {
        setState('blocked');
        return;
      }

      if (nativeStatus?.active || nativeStatus?.permission === 'granted') {
        setState('active');
        return;
      }

      setState('inactive');
      return;
    }

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
    if (variant === 'icon') {
      const timeoutId = window.setTimeout(() => {
        void refreshStatus();
      }, iconStatusRefreshDelayMs);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    void refreshStatus();
  }, [refreshStatus, variant]);

  useEffect(() => {
    if (!isNativePushShell()) {
      return;
    }

    const onNativePushStatus = () => {
      void refreshStatus();
    };

    window.addEventListener(nativePushStatusEventName, onNativePushStatus);

    return () => {
      window.removeEventListener(nativePushStatusEventName, onNativePushStatus);
    };
  }, [refreshStatus]);

  const refreshUnreadCount = useCallback(async () => {
    if (variant !== 'icon') {
      return;
    }

    try {
      const response = await fetch('/api/notifications', {
        cache: 'no-store',
      });

      if (!response.ok) {
        setUnreadCount(0);
        return;
      }

      const payload = (await response.json()) as NotificationsSummaryResponse;
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, [variant]);

  useEffect(() => {
    if (variant === 'icon') {
      const timeoutId = window.setTimeout(() => {
        void refreshUnreadCount();
      }, iconUnreadRefreshDelayMs);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    void refreshUnreadCount();
  }, [refreshUnreadCount, variant]);

  useEffect(() => {
    if (variant !== 'icon') {
      return;
    }

    const clearUnreadCount = () => {
      setUnreadCount(0);
    };

    window.addEventListener(notificationsReadEventName, clearUnreadCount);
    window.addEventListener(notificationsChangedEventName, refreshUnreadCount);

    return () => {
      window.removeEventListener(notificationsReadEventName, clearUnreadCount);
      window.removeEventListener(
        notificationsChangedEventName,
        refreshUnreadCount,
      );
    };
  }, [refreshUnreadCount, variant]);

  const enableNotifications = useCallback(async () => {
    if (isNativePushShell()) {
      const nativeStatus = getNativePushStatus();
      postToNative({ type: 'open-notification-settings' });
      setState(
        nativeStatus?.active || nativeStatus?.permission === 'granted'
          ? 'active'
          : 'blocked',
      );
      setNotice('افتح إعدادات إشعارات التطبيق لتغيير السماح أو الإيقاف.');
      return;
    }

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
    if (isNativePushShell()) {
      postToNative({ type: 'open-notification-settings' });
      setNotice('افتح إعدادات إشعارات التطبيق لتغيير السماح أو الإيقاف.');
      return;
    }

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

  const isActive = state === 'active';

  const toggleNotifications = useCallback(async () => {
    if (variant === 'icon' && state === 'checking') {
      await refreshStatus();
      return;
    }

    if (isActive) {
      await disableNotifications();
      return;
    }

    await enableNotifications();
  }, [
    disableNotifications,
    enableNotifications,
    isActive,
    refreshStatus,
    state,
    variant,
  ]);

  const disabled =
    (variant !== 'icon' && state === 'checking') ||
    state === 'working' ||
    state === 'unsupported' ||
    state === 'not_configured' ||
    (state === 'blocked' && !isNativePushShell());
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
          : '';

  if (variant === 'icon') {
    const iconLabel = isActive
      ? 'إيقاف إشعارات الرسائل'
      : 'تفعيل إشعارات الرسائل';

    return (
      <>
      <Button
        aria-label={iconLabel}
        className="shrink-0"
        disabled={disabled}
        onClick={() => void toggleNotifications()}
        size="icon-sm"
        title={notice ?? iconLabel}
        type="button"
        variant="ghost"
      >
        <span className="relative">
          {isActive ? <Bell className="size-4 text-blue-600" /> : <BellOff className="size-4" />}
          {unreadCount > 0 ? (
            <>
              <span className="pointer-events-none absolute -right-1 -top-1 size-3 rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.95)]" />
              <span className="pointer-events-none absolute -right-1 -top-1 size-3 animate-ping rounded-full bg-rose-500/60" />
            </>
          ) : null}
        </span>
      </Button>
      <FloatingActionNotice message={notice ?? undefined} open={Boolean(notice)}
        onDismiss={() => setNotice(null)} durationMs={0}
        tone={notice?.startsWith('تم تفعيل') || notice?.startsWith('تم إيقاف') ? 'success' : 'info'} />
      </>
    );
  }

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
            {helperText ? (
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {helperText}
              </p>
            ) : null}
          </div>
        </div>
        <Button
          className="rounded-md"
          disabled={disabled}
          onClick={() => void toggleNotifications()}
          type="button"
          variant={isActive ? 'outline' : 'default'}
        >
          {isActive ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {buttonText}
        </Button>
      </div>
      <FloatingActionNotice message={notice ?? undefined} open={Boolean(notice)}
        onDismiss={() => setNotice(null)} durationMs={0}
        tone={notice?.startsWith('تم تفعيل') || notice?.startsWith('تم إيقاف') ? 'success' : 'info'} />
    </section>
  );
}
