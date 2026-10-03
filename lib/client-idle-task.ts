export function scheduleIdleTask(task: () => void, timeout = 3000) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleCallbackId = window.requestIdleCallback(task, { timeout });

    return () => window.cancelIdleCallback(idleCallbackId);
  }

  const timeoutId = globalThis.setTimeout(task, Math.min(timeout, 1200));

  return () => globalThis.clearTimeout(timeoutId);
}
