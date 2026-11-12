import { getAuthSession } from '@/lib/auth/session';
import { enforceApiRateLimit, getApiRateLimitClientId } from '@/lib/api/rate-limit';
import { acquireRealtimeConnection, realtimeConnectionLifetimeMs } from '@/lib/realtime/stream-limits';
import { getRealtimeEventsSince, subscribeRealtimeEvents } from '@/lib/realtime/event-bus';
import type { RealtimeEvent } from '@/lib/realtime/events';
import { resolveRealtimeSubscriberContext } from '@/lib/realtime/authorization';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const maxBufferedBytes = 64 * 1024;
const maxPendingBytes = 128 * 1024;

function parseLastEventId(value: string | null) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function toSseEvent(event: RealtimeEvent) {
  return `id: ${event.id}\nevent: smartstore\ndata: ${JSON.stringify(event)}\n\n`;
}
function toSseHeartbeat() {
  return `event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
}

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'realtime_stream', actorId: session?.user.id,
    maxRequests: 30, windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;
  const context = await resolveRealtimeSubscriberContext(session).catch(() => undefined);
  if (context === undefined) return Response.json({ error: 'realtime_unavailable' }, {
    status: 503, headers: { 'Cache-Control': 'private, no-store' },
  });
  if (!context) return Response.json({ error: 'auth_required' }, {
    status: 401, headers: { 'Cache-Control': 'private, no-store' },
  });
  const url = new URL(request.url);
  const lastEventId = parseLastEventId(request.headers.get('last-event-id')) ??
    parseLastEventId(url.searchParams.get('lastEventId'));
  const releaseConnection = acquireRealtimeConnection(context.userId
    ? `user:${context.userId}` : `client:${getApiRateLimitClientId(request)}`);
  if (!releaseConnection) return Response.json({ error: 'realtime_capacity_exceeded' }, {
    status: 429, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
  });
  let cleanup: (() => void) | undefined;
  let flushStream: () => Promise<void> = async () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      // Replay holds references to the already bounded retained log. Encode it
      // incrementally as the reader pulls, instead of flooding the live queue.
      const replay = getRealtimeEventsSince(lastEventId, context);
      let replayIndex = 0;
      let closed = false, flushing = false;
      const pending: Uint8Array[] = [];
      let pendingBytes = 0;
      let heldFrame: Uint8Array | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        pending.length = replay.length = 0;
        pendingBytes = 0;
        heldFrame = undefined;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe?.();
        request.signal.removeEventListener('abort', close);
        releaseConnection();
        try { controller.close(); } catch { /* Runtime may have cancelled first. */ }
      };
      const hasFrames = () => Boolean(heldFrame || replayIndex < replay.length || pending.length);
      const nextFrame = () => {
        if (heldFrame) return heldFrame;
        if (replayIndex < replay.length) return encoder.encode(toSseEvent(replay[replayIndex++]));
        const frame = pending.shift();
        if (frame) pendingBytes -= frame.byteLength;
        return frame;
      };
      const flush = async () => {
        if (closed || flushing) return;
        flushing = true;
        try {
          while (!closed && hasFrames() && (controller.desiredSize ?? 0) > 0) {
            // Recheck account deletion, session expiry and current administrator
            // role before every batch, including a resumed backpressured replay.
            const current = await resolveRealtimeSubscriberContext(session);
            if (closed) return;
            if (!current || current.userId !== context.userId || current.isAdmin !== context.isAdmin) { close(); return; }
            for (let count = 0; count < 32 && !closed && hasFrames(); count++) {
              const frame = nextFrame();
              if (!frame) break;
              if (frame.byteLength > maxBufferedBytes) { close(); return; }
              if ((controller.desiredSize ?? 0) < frame.byteLength) { heldFrame = frame; return; }
              heldFrame = undefined;
              controller.enqueue(frame);
            }
          }
        } catch { close(); }
        finally { flushing = false; }
      };
      flushStream = flush;
      const sendEvent = (event: RealtimeEvent | null) => {
        if (closed) return;
        const frame = encoder.encode(event ? toSseEvent(event) : toSseHeartbeat());
        if (frame.byteLength > maxBufferedBytes || pending.length >= 2000 ||
          pendingBytes + frame.byteLength > maxPendingBytes) { close(); return; }
        pending.push(frame);
        pendingBytes += frame.byteLength;
        void flush();
      };
      controller.enqueue(encoder.encode(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`));
      const unsubscribe = subscribeRealtimeEvents(context, sendEvent);
      const heartbeat = setInterval(() => sendEvent(null), 15_000);
      // Complete before App Runner's 120-second whole-request limit.
      const lifetime = setTimeout(close, realtimeConnectionLifetimeMs());
      request.signal.addEventListener('abort', close, { once: true });
      cleanup = close;
      if (request.signal.aborted) close();
      else void flush();
    },
    pull() { return flushStream(); },
    cancel() { cleanup?.(); cleanup = undefined; },
  }, { highWaterMark: maxBufferedBytes, size: value => value.byteLength });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  } });
}
