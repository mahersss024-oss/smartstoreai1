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

export function rejectOversizedRequest(
  request: Request,
  maxBytes: number,
  message = 'Request body is too large.',
) {
  const contentLength = getRequestContentLength(request);

  if (contentLength !== null && contentLength > maxBytes) {
    return new Response(message, { status: 413 });
  }

  return null;
}
