const unsafeMutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const csrfExemptApiPaths = new Set([
  '/api/analytics/visit',
  '/api/auth/apple/callback',
]);

export function isUnsafeMutationMethod(method: string) {
  return unsafeMutationMethods.has(method.toUpperCase());
}

export function isCsrfExemptApiPath(pathname: string) {
  return csrfExemptApiPaths.has(pathname);
}

function parseOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return 'invalid';
  }
}

export function isSameOriginApiMutationAllowed(request: Request) {
  if (!isUnsafeMutationMethod(request.method)) {
    return true;
  }

  const requestUrl = new URL(request.url);

  if (
    !requestUrl.pathname.startsWith('/api/') ||
    isCsrfExemptApiPath(requestUrl.pathname)
  ) {
    return true;
  }

  const origin = parseOrigin(request.headers.get('origin'));

  if (origin === 'invalid') {
    return false;
  }

  if (origin) {
    return origin === requestUrl.origin;
  }

  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();

  return secFetchSite !== 'cross-site';
}
