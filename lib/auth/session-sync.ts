const sessionSignalKey = 'smartstore:auth-session-changed';

export function announceAuthSessionChange() {
  const signal = crypto.randomUUID();
  try {
    const channel = new BroadcastChannel(sessionSignalKey);
    channel.postMessage(signal);
    channel.close();
  } catch {
    // Storage events also support browsers without BroadcastChannel.
  }
  try {
    localStorage.setItem(sessionSignalKey, signal);
  } catch {
    // The channel remains usable when browser storage is disabled.
  }
}

export function subscribeAuthSessionChanges(onChange: () => void) {
  let lastSignal: string | null = null;
  const receive = (signal: unknown) => {
    if (typeof signal !== 'string' || signal.length > 80 || signal === lastSignal) return;
    lastSignal = signal;
    onChange();
  };
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(sessionSignalKey);
    channel.onmessage = event => receive(event.data);
  } catch {
    // Fall back to storage events when channels are unavailable.
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === sessionSignalKey) receive(event.newValue);
  };
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}
