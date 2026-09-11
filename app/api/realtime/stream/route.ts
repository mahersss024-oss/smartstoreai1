import {
  getAuthSession,
  isAdminSession,
} from '@/lib/auth/session';
import {
  getRealtimeEventsSince,
  subscribeRealtimeEvents,
} from '@/lib/realtime/event-bus';
import type { RealtimeEvent } from '@/lib/realtime/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Close idle SSE connections so serverless/edge runtimes and proxies that cap
// long-lived requests can recycle them cleanly. Clients reconnect automatically
// and replay with Last-Event-ID.
const maxConnectionLifetimeMs = Number.parseInt(
  process.env.SMARTSTORE_SSE_MAX_LIFETIME_MS ?? '',
  10,
);
const connectionLifetimeMs = Number.isFinite(maxConnectionLifetimeMs)
  ? Math.max(15_000, maxConnectionLifetimeMs)
  : 5 * 60_000;

function parseLastEventId(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toSseEvent(event: RealtimeEvent) {
  return `id: ${event.id}\nevent: smartstore\ndata: ${JSON.stringify(event)}\n\n`;
}

function toSseHeartbeat() {
  return `event: heartbeat\ndata: ${JSON.stringify({
    at: new Date().toISOString(),
  })}\n\n`;
}

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const context = {
    userId: session?.user.id ?? null,
    isAdmin: isAdminSession(session),
  };
  const url = new URL(request.url);
  const lastEventId =
    parseLastEventId(request.headers.get('last-event-id')) ??
    parseLastEventId(url.searchParams.get('lastEventId'));
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeatId: ReturnType<typeof setInterval> | null = null;
      let lifetimeId: ReturnType<typeof setTimeout> | null = null;

      const write = (value: string) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(value));
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (heartbeatId !== null) {
        clearInterval(heartbeatId);
          heartbeatId = null;
        }

        if (lifetimeId !== null) {
          clearTimeout(lifetimeId);
          lifetimeId = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        request.signal.removeEventListener('abort', onAbort);

        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };

      const onAbort = () => {
        close();
      };

      const sendEvent = (event: RealtimeEvent) => {
        write(toSseEvent(event));
      };

      write(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({
        connectedAt: new Date().toISOString(),
      })}\n\n`);

      const replayEvents = getRealtimeEventsSince(lastEventId, context);

      for (const event of replayEvents) {
        sendEvent(event);
      }

      unsubscribe = subscribeRealtimeEvents(context, sendEvent);
      heartbeatId = setInterval(() => {
        write(toSseHeartbeat());
      }, 15_000);
      lifetimeId = setTimeout(() => {
        // Graceful end-of-life close; the client reconnects and replays.
        close();
      }, connectionLifetimeMs);

      request.signal.addEventListener('abort', onAbort, { once: true });
      cleanup = close;
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

