const defaultFetchTimeoutMs = 10_000;

function createTimeoutReason() {
  return new DOMException('Request timed out.', 'TimeoutError');
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = defaultFetchTimeoutMs,
) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => {
    controller.abort(externalSignal?.reason);
  };
  const timeout = setTimeout(
    () => controller.abort(createTimeoutReason()),
    timeoutMs,
  );

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else {
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    });
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}
