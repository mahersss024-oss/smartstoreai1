const productionCanonicalUrl = 'https://www.smartstore-ai.com';
const productionHosts = new Set(['www.smartstore-ai.com', 'smartstore-ai.com']);

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function getUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isRenderUrl(value: string) {
  return getUrl(value)?.hostname.endsWith('.onrender.com') ?? false;
}

function isTrustedProductionOrigin(value: string) {
  const url = getUrl(value);

  return Boolean(
    url &&
      url.protocol === 'https:' &&
      productionHosts.has(url.hostname.toLowerCase()),
  );
}

export function getAppBaseUrl(request?: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (
    configuredUrl &&
    !(process.env.NODE_ENV === 'production' && isRenderUrl(configuredUrl))
  ) {
    return normalizeBaseUrl(configuredUrl);
  }

  if (request) {
    const requestOrigin = new URL(request.url).origin;

    if (process.env.NODE_ENV === 'production') {
      return isTrustedProductionOrigin(requestOrigin)
        ? requestOrigin
        : productionCanonicalUrl;
    }

    return requestOrigin;
  }

  return process.env.NODE_ENV === 'production'
    ? productionCanonicalUrl
    : 'http://localhost:3000';
}

// Static base URL resolved once for client/server use where a Request is
// unavailable (e.g. building share/deep links in the browser).
export const appUrl = getAppBaseUrl();
