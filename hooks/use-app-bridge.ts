'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  detectAppPlatform,
  isInsideNativeApp,
  postToNative,
  subscribeToNativeMessages,
  type AppBridgeInboundMessage,
  type AppBridgeOutboundMessage,
  type AppBridgePlatform,
} from '@/lib/native/app-bridge';
import { isSafeInternalPath } from '@/lib/native/deep-links';
type UseAppBridgeResult = {
  isNativeApp: boolean;
  platform: AppBridgePlatform;
  send: (message: AppBridgeOutboundMessage) => boolean;
};

/**
 * Connects the web app to a native WebView shell:
 * - announces readiness once mounted
 * - forwards native navigation/back/resume messages into Next.js routing
 * - applies theme changes requested by the native shell
 */
export function useAppBridge(): UseAppBridgeResult {
    const router = useRouter();
  // SSR-safe: both helpers guard for a missing window and return web defaults.
  const [isNativeApp] = useState(() => isInsideNativeApp());
  const [platform] = useState<AppBridgePlatform>(() => detectAppPlatform());
  const announcedRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.nativeApp = isNativeApp ? 'true' : 'false';
    root.dataset.platform = platform;

    if (!isNativeApp || platform !== 'android') {
      root.style.removeProperty('--native-status-bar-inset');
    }

    if (!isNativeApp || announcedRef.current) {
      return;
    }

    announcedRef.current = true;
    postToNative({ type: 'ready', platform, version: '1' });
  }, [isNativeApp, platform]);

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    const unsubscribe = subscribeToNativeMessages(
      (message: AppBridgeInboundMessage) => {
        switch (message.type) {
          case 'navigate': {
            if (message.url && isSafeInternalPath(message.url)) {
              router.push(message.url);
            }
            break;
          }
          case 'back': {
            router.back();
            break;
          }
          case 'theme-changed': {
            const root = document.documentElement;
            root.classList.toggle('dark', message.theme === 'dark');
            break;
          }
          case 'resume': {
            router.refresh();
            break;
          }
          case 'viewport-insets': {
            if (
              platform === 'android' &&
              typeof message.statusBarInset === 'number' &&
              Number.isFinite(message.statusBarInset) &&
              message.statusBarInset >= 0
            ) {
              document.documentElement.style.setProperty(
                '--native-status-bar-inset',
                `${Math.min(message.statusBarInset, 96)}px`,
              );
            }
            break;
          }
        }
      },
    );

    return unsubscribe;
  }, [isNativeApp, platform, router]);

  return {
    isNativeApp,
    platform,
    send: postToNative,
  };
}

