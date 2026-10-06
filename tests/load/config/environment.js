export function requiredEnv(name, fallback = '') {
  return (__ENV[name] || fallback).trim();
}

export function numberEnv(name, fallback) {
  const parsed = Number.parseInt(requiredEnv(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function boolEnv(name, fallback = false) {
  const value = requiredEnv(name).toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

export function listEnv(name, fallback) {
  const raw = requiredEnv(name);
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

export const loadEnv = {
  baseUrl: requiredEnv('K6_BASE_URL', 'http://127.0.0.1:3000').replace(/\/$/, ''),
  environment: requiredEnv('K6_ENV', 'local').toLowerCase(),
  maxVus: numberEnv('SMARTSTORE_LOAD_MAX_VUS', numberEnv('K6_MAX_VUS', 50)),
  duration: requiredEnv('SMARTSTORE_LOAD_DURATION', requiredEnv('K6_DURATION', '5m')),
  stage: requiredEnv('K6_STAGE', 'light').toLowerCase(),
  sessionCookie: requiredEnv('K6_SESSION_COOKIE'),
  ownerSessionCookie: requiredEnv('K6_OWNER_SESSION_COOKIE'),
  allowWrites: boolEnv('ALLOW_LOAD_TEST_WRITES'),
  allowProductionLoad: boolEnv('ALLOW_PRODUCTION_LOAD_TEST'),
  testUserPrefix: requiredEnv('K6_TEST_USER_PREFIX', 'load-user'),
  listingIds: listEnv('K6_LISTING_IDS', []),
  searchTerms: listEnv('K6_SEARCH_TERMS', [
    'camry',
    'iphone',
    'sofa',
    'laptop',
    'bicycle',
  ]),
  cities: listEnv('K6_CITIES', [
    'riyadh',
    'jeddah',
    'dammam',
    'makkah',
    'madinah',
  ]),
};

export function url(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${loadEnv.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isProduction() {
  return loadEnv.environment === 'production' || /souqhamad\.com$/i.test(loadEnv.baseUrl);
}

export function assertSafeReadScenario() {
  if (isProduction() && !loadEnv.allowProductionLoad) {
    throw new Error(
      'Production load tests require ALLOW_PRODUCTION_LOAD_TEST=true. Use staging first.',
    );
  }
}

export function assertSafeWriteScenario() {
  assertSafeReadScenario();

  if (isProduction()) {
    throw new Error('Write load tests are blocked in production.');
  }

  if (!loadEnv.allowWrites) {
    throw new Error('Write tests require ALLOW_LOAD_TEST_WRITES=true.');
  }

  if (!loadEnv.sessionCookie) {
    throw new Error('Write tests require K6_SESSION_COOKIE for a test account.');
  }
}
