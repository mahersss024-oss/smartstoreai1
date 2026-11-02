const defaultFetchTimeoutMs = 10_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = defaultFetchTimeoutMs,
) {
  const externalSignal = init.signal === undefined && input instanceof Request
    ? input.signal
    : init.signal;
  // fetch resolves when headers arrive, before json()/text()/stream reads finish.
  // Keep the deadline on the native response body as well as the initial request;
  // composing signals also preserves caller cancellation throughout both phases.
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new DOMException('Request timed out.', 'TimeoutError'));
  }, timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: externalSignal
        ? AbortSignal.any([externalSignal, deadline.signal])
        : deadline.signal,
    });
    // The response socket now keeps in-progress I/O alive. Do not leave an idle
    // deadline keeping a process alive after callers consume/cancel the body.
    if (response.body) timer.unref?.();
    else clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
