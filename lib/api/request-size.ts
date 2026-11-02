export function getRequestContentLength(request: Request) {
  const rawContentLength = request.headers.get('content-length');

  if (!rawContentLength) {
    return null;
  }

  if (!/^\d+$/.test(rawContentLength)) {
    return null;
  }

  const contentLength = Number(rawContentLength);

  return Number.isFinite(contentLength) && contentLength >= 0
    ? contentLength
    : null;
}

function cancelBody(request: Request, reader?: ReadableStreamDefaultReader<Uint8Array>) {
  // A tee branch's cancellation can wait for its sibling. Cancel both without
  // awaiting either one, including when the client stops sending mid-request.
  if (reader) void reader.cancel().catch(() => {});
  try { void request.body?.cancel().catch(() => {}); } catch { /* Already locked/closed. */ }
}

export async function rejectOversizedRequest(
  request: Request,
  maxBytes: number,
  message = 'Request body is too large.',
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new RangeError('The request body limit must be a nonnegative integer.');
  const contentLength = getRequestContentLength(request);

  if (contentLength !== null && contentLength > maxBytes) {
    cancelBody(request);
    return new Response(message, { status: 413 });
  }

  if (!request.body) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.clone().body!.getReader(); }
  catch { return new Response('Invalid request body.', { status: 400 }); }

  let interrupted = request.signal.aborted;
  const onAbort = () => { interrupted = true; cancelBody(request, reader); };
  request.signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (interrupted) onAbort();
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (interrupted) return new Response('Request body was interrupted.', { status: 408 });
      if (next.done) return null;
      size += next.value.byteLength;
      if (size > maxBytes) {
        cancelBody(request, reader);
        return new Response(message, { status: 413 });
      }
    }
  } catch {
    cancelBody(request, reader);
    return new Response('Invalid request body.', { status: interrupted ? 408 : 400 });
  } finally {
    request.signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
