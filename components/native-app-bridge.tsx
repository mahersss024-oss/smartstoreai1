'use client';

import { useAppBridge } from '@/hooks/use-app-bridge';

/**
 * Mounts the native WebView bridge. The hook itself reflects platform state
 * onto <html> via effects, so this component only needs to keep the bridge
 * alive and intentionally renders nothing.
 */
export function NativeAppBridge() {
  useAppBridge();
  return null;
}

