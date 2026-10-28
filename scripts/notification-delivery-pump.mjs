/**
 * The server supervisor polls its own authenticated loopback endpoint. Durable
 * rows/leases live in PostgreSQL; this timer is only a restart-safe trigger.
 * @param {{port: string | number, secret?: string, enabled: boolean, fetch?: typeof globalThis.fetch, intervalMs?: number}} options
 */
export function startNotificationDeliveryPump({ port, secret, enabled, fetch = globalThis.fetch, intervalMs = 15000 }) {
  if (!enabled || !secret || secret.length < 32) return () => {};
  const value = String(port);
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error('invalid_local_notification_port');
  const url = `http://127.0.0.1:${value}/api/internal/notifications/drain`;
  let stopped = false;
  let controller;
  const timer = setInterval(async () => {
    if (stopped || controller) return;
    const current = new AbortController();
    controller = current;
    const deadline = setTimeout(() => current.abort(), 45000);
    try {
      const response = await fetch(url, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${secret}` }, signal: current.signal });
      await response.body?.cancel();
      if (!response.ok && !stopped) console.warn(`[notification_delivery_pump] status=${response.status}`);
    } catch { if (!stopped) console.warn('[notification_delivery_pump] unavailable'); }
    finally { clearTimeout(deadline); controller = undefined; }
  }, Math.max(1000, intervalMs));
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); controller?.abort(); };
}
