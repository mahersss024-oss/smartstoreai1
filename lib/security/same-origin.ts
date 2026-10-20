const unsafeMutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const csrfExemptApiPaths = new Set([
  '/api/analytics/visit',
  '/api/auth/apple/callback',
]);
const productionSameSiteOrigins = new Set([
  'https://souqhamad.com',
  'https://www.souqhamad.com',
]);

export function isUnsafeMutationMethod(method: string) {
  return unsafeMutationMethods.has(method.toUpperCase());
}

function isCsrfExemptApiPath(pathname: string) {
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

function getTrustedRequestOrigins(requestOrigin: string) {
  const trustedOrigins = new Set([requestOrigin]);
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (productionSameSiteOrigins.has(requestOrigin)) {
    for (const origin of productionSameSiteOrigins) {
      trustedOrigins.add(origin);
    }
  }

  if (configuredUrl) {
    const configuredOrigin = parseOrigin(configuredUrl);

    if (configuredOrigin && configuredOrigin !== 'invalid') {
      trustedOrigins.add(configuredOrigin);

      if (productionSameSiteOrigins.has(configuredOrigin)) {
        for (const origin of productionSameSiteOrigins) {
          trustedOrigins.add(origin);
        }
      }
    }
  }

  return trustedOrigins;
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
    return getTrustedRequestOrigins(requestUrl.origin).has(origin);
  }

  const secFetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();

  return secFetchSite !== 'cross-site';
}
