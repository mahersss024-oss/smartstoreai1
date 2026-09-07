const productionCanonicalUrl = 'https://www.smartstore-ai.com';

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function getAppBaseUrl(request?: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredUrl) {
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
