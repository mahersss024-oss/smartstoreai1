# Production readiness gaps

This project now has local verification, browser E2E, readiness checks, optional
database integration coverage, and runtime metrics for the AI and image upload
paths. The remaining production-readiness work depends on real infrastructure,
not only code in the repository.

## Required before launch

1. Configure a staging environment that mirrors production.

Required staging variables:

- `NODE_ENV=production`
- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `DATABASE_URL`
- `SMARTSTORE_MARKETPLACE_STORE=database`
- `DEEPSEEK_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SMARTSTORE_IMAGE_STORAGE=cloudinary`, `s3`, or `object`
- The matching Cloudinary or S3-compatible storage credentials

Optional but launch-relevant variables:

- `APPLE_CLIENT_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `SMARTSTORE_RATE_LIMIT_BACKEND`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SMARTSTORE_VAPID_PUBLIC_KEY`
- `SMARTSTORE_VAPID_PRIVATE_KEY`
- `SMARTSTORE_VAPID_SUBJECT`

2. Run the repository gate locally and in CI:

```bash
pnpm verify
pnpm test:e2e
pnpm readiness
```

3. Run readiness against staging:

```bash
NODE_ENV=production READINESS_BASE_URL=https://staging.example.com pnpm readiness
```

4. Run the optional DB integration test against a disposable staging database:

```bash
SMARTSTORE_DB_INTEGRATION=1 SMARTSTORE_MARKETPLACE_STORE=database pnpm test:db:integration
```

5. Run real-device mobile checks.

Minimum manual pass:

- iPhone Safari browser.
- iPhone installed PWA from Safari Add to Home Screen.
- Android Chrome browser.
- Android installed PWA.
- Chat keyboard open and close several times.
- Login provider menu.
- Create listing with images.
- Favorite and unfavorite listings.
- Buyer-seller conversation and official contact sharing.

6. Run controlled load and soak tests against staging.

Minimum pass:

- `pnpm test:ai-load` with the real DeepSeek provider and realistic concurrency.
- At least one extended soak run long enough to detect queue growth, memory
  growth, or unstable provider latency.
- Verify `/api/health` remains healthy under load.

## CI setup

The repository includes `.github/workflows/production-gate.yml`.

For optional database integration in CI:

- Add repository variable `RUN_STAGING_DB_INTEGRATION=1`.
- Add repository secret `STAGING_DATABASE_URL`.
- Use only a staging database that can safely receive synthetic test data.

## Current honest status

Production readiness is high, but not 100 percent proven until staging and
real-device checks pass. The remaining risk is operational verification:
provider limits, storage credentials, OAuth credentials, real database behavior,
mobile Safari/PWA behavior, and monitoring under real traffic.
