// Bridge between the سوق حمد web app and native WebView wrappers
// (iOS WKWebView / Android WebView). The web app talks to the native shell via
// window.ReactNativeWebView.postMessage (RN) and a generic
// window.SmartStoreNative.postMessage (custom shells). Incoming native
// messages arrive as window 'message' events or via a global callback.

export type AppBridgePlatform = 'web' | 'ios' | 'android';

export type AppBridgeOutboundMessage =
  | { type: 'ready'; platform: AppBridgePlatform; version: string }
  | { type: 'navigate'; url: string }
  | { type: 'share'; url: string; title?: string }
  | { type: 'haptic'; style: 'light' | 'medium' | 'heavy' | 'success' }
  | { type: 'open-external'; url: string }
  | { type: 'set-theme'; theme: 'light' | 'dark' };

export type AppBridgeInboundMessage =
  | { type: 'theme-changed'; theme: 'light' | 'dark' }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'resume' }
  | { type: 'viewport-insets'; statusBarInset?: number };

type NativeShell = {
  postMessage: (payload: string) => void;
};

type BridgeWindow = Window & {
  ReactNativeWebView?: NativeShell;
  SmartStoreNative?: NativeShell;
  webkit?: {
    messageHandlers?: {
      smartstore?: NativeShell;
    };
  };
};

export function detectAppPlatform(): AppBridgePlatform {
  if (typeof navigator === 'undefined') {
    return 'web';
  }

  const userAgent = navigator.userAgent;

  if (/android/i.test(userAgent)) {
    return 'android';
  }

  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return 'ios';
  }

  return 'web';
}

export function isInsideNativeApp(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const bridgeWindow = window as BridgeWindow;

  return Boolean(
    bridgeWindow.ReactNativeWebView ||
      bridgeWindow.SmartStoreNative ||
      bridgeWindow.webkit?.messageHandlers?.smartstore,
  );
}

export function postToNative(message: AppBridgeOutboundMessage): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const bridgeWindow = window as BridgeWindow;
  const payload = JSON.stringify(message);
  const shells = [
    bridgeWindow.ReactNativeWebView,
    bridgeWindow.SmartStoreNative,
    bridgeWindow.webkit?.messageHandlers?.smartstore,
  ].filter((shell): shell is NativeShell => Boolean(shell));

  if (shells.length === 0) {
    return false;
  }

  for (const shell of shells) {
    try {
      shell.postMessage(payload);
    } catch {
      // A single failed shell must not block others.
    }
  }

  return true;
}

function parseInboundMessage(raw: unknown): AppBridgeInboundMessage | null {
  if (typeof raw !== 'string' && typeof raw !== 'object') {
    return null;
  }

  try {
    const value =
      typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;

    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.type !== 'string') {
      return null;
    }

    return record as AppBridgeInboundMessage;
  } catch {
    return null;
  }
}

/**
 * Subscribes to messages coming from the native shell.
 * @returns an unsubscribe function.
 */
export function subscribeToNativeMessages(
  handler: (message: AppBridgeInboundMessage) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const onMessage = (event: MessageEvent) => {
    const parsed = parseInboundMessage(event.data);

    if (parsed) {
      handler(parsed);
    }
  };

  window.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener('message', onMessage);
  };
}

