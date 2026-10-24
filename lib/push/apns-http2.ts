import http2, { type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2';

type ApnsHttp2Request = {
  host: string;
  token: string;
  authorization: string;
  topic: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type ApnsHttp2Response = { status: number; reason?: string };

const apnsHosts = new Set(['https://api.push.apple.com', 'https://api.sandbox.push.apple.com']);
const maxResponseBytes = 16 * 1024;

function responseReason(body: string) {
  try {
    const payload = JSON.parse(body) as { reason?: unknown } | null;
    return typeof payload?.reason === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(payload.reason)
      ? payload.reason : undefined;
  } catch {
    return undefined;
  }
}

/** Native device APNs requires HTTP/2 over TLS, unlike browser Web Push.
 * The deadline covers DNS/TLS, response headers and the entire response body.
 * This request owns its connection and tears it down on every completion path.
 */
export async function postApnsHttp2(input: ApnsHttp2Request): Promise<ApnsHttp2Response> {
  if (!apnsHosts.has(input.host)) throw new Error('apns_http2_invalid_host');
  if (input.signal?.aborted) throw new Error('apns_http2_aborted');
  const body = JSON.stringify(input.payload);
  const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1, Math.min(input.timeoutMs, 30_000)) : 10_000;

  return new Promise((resolve, reject) => {
    let session: ClientHttp2Session | undefined;
    let stream: ClientHttp2Stream | undefined;
    let settled = false;
    let status = 0;
    let receivedBytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, response?: ApnsHttp2Response) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      input.signal?.removeEventListener('abort', onAbort);
      // Keep the error handlers attached: closing a failed TLS session/stream
      // can emit another asynchronous error, which must remain handled.
      try { stream?.close(http2.constants.NGHTTP2_CANCEL); } catch { /* Already closed. */ }
      try { stream?.destroy(); } catch { /* Already destroyed. */ }
      try { session?.close(); } catch { /* Already closed. */ }
      try { session?.destroy(); } catch { /* Already destroyed. */ }
      if (error) reject(error);
      else resolve(response!);
    };
    const onAbort = () => finish(new Error('apns_http2_aborted'));
    const deadline = setTimeout(() => finish(new Error('apns_http2_timeout')), timeoutMs);
    input.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      session = http2.connect(input.host, {
        minVersion: 'TLSv1.2', ALPNProtocols: ['h2'], settings: { enablePush: false },
      });
      session.on('error', () => finish(new Error('apns_http2_session_error')));
      session.on('close', () => finish(new Error('apns_http2_connection_closed')));
      session.on('goaway', () => finish(new Error('apns_http2_goaway')));
      session.on('connect', () => {
        if (session?.alpnProtocol !== 'h2') finish(new Error('apns_http2_negotiation_failed'));
      });
      stream = session.request({
        ':method': 'POST', ':path': `/3/device/${encodeURIComponent(input.token)}`,
        authorization: input.authorization,
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'apns-topic': input.topic, 'apns-push-type': 'alert',
        'apns-priority': '10', 'apns-expiration': '0',
      });
      stream.on('error', () => finish(new Error('apns_http2_stream_error')));
      stream.on('aborted', () => finish(new Error('apns_http2_stream_aborted')));
      stream.on('close', () => finish(new Error('apns_http2_response_incomplete')));
      stream.on('response', headers => {
        const value = headers[':status'];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 599) {
          finish(new Error('apns_http2_invalid_status'));
          return;
        }
        status = value;
      });
      stream.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.length;
        if (receivedBytes > maxResponseBytes) { finish(new Error('apns_http2_response_too_large')); return; }
        chunks.push(bytes);
      });
      stream.on('end', () => {
        if (!status) { finish(new Error('apns_http2_missing_status')); return; }
        finish(undefined, { status, reason: responseReason(Buffer.concat(chunks).toString('utf8')) });
      });
      stream.end(body);
    } catch {
      finish(new Error('apns_http2_request_failed'));
    }
  });
}
