const activeClients = new Map<string, number>();
let activeConnections = 0;

function configuredLimit(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

/** Per-process admission complements the shared opening-rate limiter. */
export function acquireRealtimeConnection(clientId: string): (() => void) | null {
  const totalLimit = configuredLimit('SMARTSTORE_SSE_MAX_CONNECTIONS', 256, 4096);
  const clientLimit = configuredLimit('SMARTSTORE_SSE_MAX_CONNECTIONS_PER_CLIENT', 6, 32);
  const current = activeClients.get(clientId) ?? 0;
  if (activeConnections >= totalLimit || current >= clientLimit) return null;
  activeConnections++;
  activeClients.set(clientId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeConnections--;
    const remaining = (activeClients.get(clientId) ?? 1) - 1;
    if (remaining > 0) activeClients.set(clientId, remaining);
    else activeClients.delete(clientId);
  };
}

export function realtimeConnectionLifetimeMs() {
  const configured = Number(process.env.SMARTSTORE_SSE_MAX_LIFETIME_MS);
  // App Runner caps the whole request at 120 seconds, even with heartbeat data.
  return Number.isFinite(configured) && configured > 0
    ? Math.min(110_000, Math.max(15_000, configured))
    : 110_000;
}
