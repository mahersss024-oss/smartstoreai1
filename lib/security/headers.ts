// Centralized security header definitions for the whole site.
//
// The Content-Security-Policy is intentionally strict but allows the external
// origins SmartStore AI actually uses: Google profile images, Cloudinary, and
// an optional object-storage public domain. Style-src keeps `'unsafe-inline'`
// because theme tokens are injected via inline <style> and Next.js streams
// inline styles.

const imageOrigins = [
  'https://res.cloudinary.com',
  'https://lh3.googleusercontent.com',
];

const connectOrigins = [
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com',
];

function readPublicImageOrigin() {
  const value = process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL?.trim();

  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy() {
  const publicImageOrigin = readPublicImageOrigin();
  const imgSrc = ["'self'", 'data:', 'blob:', ...imageOrigins];

  if (publicImageOrigin) {
    imgSrc.push(publicImageOrigin);
  }

  // Next.js (Turbopack) evaluates its runtime chunks with eval()/new Function()
  // in the browser, so `'unsafe-eval'` is required for the framework to boot.
  // It is scoped to script-src only and still forbids remote scripts, keeping
  // the meaningful protections (no third-party code execution) intact.
  const scriptSrc = ["'self'", "'unsafe-inline'", "'unsafe-eval'"].join(' ');

  const directives = [
    "default-src 'self'",
    `img-src ${imgSrc.join(' ')}`,
    `connect-src 'self' ${connectOrigins.join(' ')}`,
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ];

  return directives.join('; ');
}

type SecurityHeader = { key: string; value: string };

export function getSecurityHeaders(): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(self)',
    },
    {
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin-allow-popups',
    },
    {
      key: 'X-DNS-Prefetch-Control',
      value: 'on',
    },
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
  ];

  if (process.env.NODE_ENV === 'production') {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }

  return headers;
}
