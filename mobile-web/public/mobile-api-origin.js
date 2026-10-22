(() => {
  const apiOrigin = 'https://souqhamad.com';
  const nativeFetch = window.fetch.bind(window);
  const pendingRequests = new Map();
  if (window.SmartStoreNative?.postMessage) window.EventSource = undefined;

  window.__smartstoreNativeApiResolve = (requestId, result) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    pending.signal?.removeEventListener('abort', pending.abort);

    if (result.error) {
      pending.reject(new TypeError(result.error));
      return;
    }

    const emptyBodyStatus = result.status === 204 || result.status === 205 || result.status === 304;
    const response = new Response(emptyBodyStatus ? null : result.body ?? null, {
      status: result.status,
      headers: result.headers ?? {},
    });
    Object.defineProperty(response, 'url', { value: result.url });
    pending.resolve(response);
  };

  function toBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function nativeApiFetch(url, input, init) {
    const source = input instanceof Request
      ? new Request(url.href, input)
      : new Request(url.href, init);
    const request = init && input instanceof Request ? new Request(source, init) : source;
    const requestId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const signal = request.signal;

    if (signal.aborted) throw new DOMException('The request was aborted.', 'AbortError');

    const body = request.method === 'GET' || request.method === 'HEAD'
      ? new Uint8Array()
      : new Uint8Array(await request.clone().arrayBuffer());

    return new Promise((resolve, reject) => {
      const abort = () => {
        pendingRequests.delete(requestId);
        reject(new DOMException('The request was aborted.', 'AbortError'));
      };

      pendingRequests.set(requestId, { resolve, reject, signal, abort });
      signal.addEventListener('abort', abort, { once: true });

      try {
        window.SmartStoreNative.postMessage(JSON.stringify({
          type: 'api-fetch',
          id: requestId,
          url: url.href,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          bodyBase64: body.length ? toBase64(body) : '',
        }));
      } catch (error) {
        pendingRequests.delete(requestId);
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }

  function rewriteRequest(input, init) {
    let url;
    let originalRequest = null;

    if (input instanceof Request) {
      originalRequest = input;
      url = new URL(input.url);
    } else {
      url = new URL(input instanceof URL ? input.href : String(input), document.baseURI);
    }

    if ((url.origin !== window.location.origin && url.origin !== apiOrigin) || !url.pathname.startsWith('/api/')) {
      return [input, init];
    }

    const apiBase = new URL(apiOrigin);
    url.protocol = apiBase.protocol;
    url.host = apiBase.host;
    const credentials = init?.credentials || originalRequest?.credentials || 'include';
    const nextInit = init ? { ...init, credentials } : { credentials };

    if (originalRequest) {
      return [new Request(url.href, originalRequest), nextInit, url];
    }

    return [url.href, nextInit, url];
  }

  window.fetch = (input, init) => {
    const [nextInput, nextInit, url] = rewriteRequest(input, init);
    if (!url) return nativeFetch(nextInput, nextInit);
    if (window.SmartStoreNative?.postMessage) {
      return nativeApiFetch(url, input, nextInit);
    }
    return nativeFetch(nextInput, nextInit);
  };
})();
