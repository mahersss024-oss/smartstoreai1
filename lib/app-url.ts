const productionCanonicalUrl = 'https://souqhamad.com';
const productionHosts = new Set(['www.souqhamad.com', 'souqhamad.com']);

function normalizeBaseUrl(value: string) {
  const normalizedValue = value.trim().replace(/\/+$/, '');
  const url = getUrl(normalizedValue);

  if (url && productionHosts.has(url.hostname.toLowerCase())) {
    url.protocol = 'https:';
    url.hostname = 'souqhamad.com';
    url.port = '';

    return url.origin;
  }

  return normalizedValue;
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
      return productionCanonicalUrl;
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
