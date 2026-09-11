const productionCanonicalUrl = 'https://www.smartstore-ai.com';

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function isRenderUrl(value: string) {
  try {
    return new URL(value).hostname.endsWith('.onrender.com');
  } catch {
    return false;
  }
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

    if (
      process.env.NODE_ENV === 'production' &&
      requestOrigin.endsWith('.onrender.com')
    ) {
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
