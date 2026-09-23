# Production Readiness Gaps

This project now has local verification, browser E2E, readiness checks, optional
database integration coverage, and runtime metrics for the AI and image upload
paths. The remaining production-readiness work depends on real infrastructure,
not only code in the repository.

## Current Score

Current code-level readiness after the latest local audit: **87/100**.

This score is intentionally conservative. Passing lint, TypeScript, unit tests,
E2E tests, production build, audit, and local AI load tests is strong evidence,
but it does not prove real production behavior by itself.

To raise the project to the **93-95/100** range, the remaining verification must
run against real or staging-equivalent infrastructure:

- Real PostgreSQL database through `DATABASE_URL`.
- Real DeepSeek provider, not the mocked load-test provider.
- Real iPhone Safari and installed PWA behavior.
- Production-style monitoring and an extended soak test.

## Target 93-95/100 Gate

Do not mark the project as production-ready at the 93-95/100 level until every
item below has passed and the results are recorded.

## Latest External Verification Log

Date: 2026-09-14.

Completed:

- Pushed production-hardening changes to `main`.
- Live smoke test passed for:
  - `/`
  - `/api/health`
  - `/api/marketplace/listings?page=1&limit=24`
  - `/manifest.webmanifest`
  - `/sw.js`
- Live `/api/health` returned `status=ok`, `database=ok`, and
  `store=database`.
- Real DeepSeek AI load test completed locally through the real provider with
  `AI_LOAD_MODE=real` and `AI_LOAD_LEVELS=10,25,50,100`.
- Direct buyer search requests now use a bounded search fast path after the
  marketplace intent checks. This keeps the dedicated search-understanding model
  while avoiding the heavier general chat generation and output-check phases for
  simple search requests.

Real DeepSeek load results after the search fast path:

| Concurrent users | Success | HTTP errors | Empty bodies | Incomplete streams | Provider calls | Queue p95 | Provider fetch p95 | End-to-end p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 10/10 | 0 | 0 | 0 | 20 | 16ms | 2577ms | 5250ms |
| 25 | 25/25 | 0 | 0 | 0 | 50 | 6ms | 1198ms | 2947ms |
| 50 | 50/50 | 0 | 0 | 0 | 100 | 10ms | 1220ms | 3826ms |
| 100 | 100/100 | 0 | 0 | 0 | 200 | 15ms | 1173ms | 3065ms |

Before the fast path, the same real DeepSeek search load made about five
provider calls per chat request and reached roughly 22.6s p95 at 100 concurrent
users. After the fast path, direct search uses two provider calls per request and
the 100-concurrent p95 dropped to about 3.1s. Queue p95 stayed below 20ms, so the
remaining bottleneck is external provider latency rather than local queueing.

Still pending for 93-95/100:

- Run DB integration against a disposable staging PostgreSQL database.
- Run iPhone/iPad Safari and installed-PWA manual checks.
- Enable production-style monitoring and run a 30-60 minute soak test.

### 1. Real Database Verification

Run the optional integration test against a disposable PostgreSQL database that
matches production as closely as possible:

```bash
SMARTSTORE_DB_INTEGRATION=1 SMARTSTORE_MARKETPLACE_STORE=database pnpm test:db:integration
```

Minimum pass criteria:

- Image concurrency test keeps each listing within the hard image limit.
- Favorite toggle race test keeps `favoriteCount` equal to the real favorite
  rows.
- No failed transactions, duplicate critical records, or orphaned relational
  data.

### 2. Real DeepSeek Load Verification

Run the AI path load test with the real DeepSeek provider enabled, gradually and
only from staging or another safe environment:

```bash
AI_LOAD_MODE=real AI_LOAD_LEVELS=10,25,50,100 pnpm test:ai-load
```

Minimum pass criteria:

- No lost requests.
- No empty assistant responses.
- No incomplete streams.
- Controlled handling for provider limits such as 429, 5xx, timeouts, or queue
  overflow.
- p95 latency remains acceptable for the user experience at the highest tested
  concurrency.
- Queue wait, backend time, and provider time are compared so the bottleneck is
  identified clearly.

### 3. Safari And Installed PWA Verification

Manually verify on physical devices or a trusted real-device cloud:

- iPhone Safari browser.
- iPhone app installed through Safari Add to Home Screen.
- iPad Safari and installed PWA.
- Android Chrome browser.
- Android installed PWA.

Minimum pass criteria:

- Welcome screen appears only when intended and does not flash during normal
  navigation.
- Chat input stays above the keyboard every time the keyboard opens.
- Closing the keyboard restores the existing layout with no permanent height or
  bottom-sheet changes.
- Navigating from chat to account/listing pages and back preserves the intended
  in-app chat session behavior.
- Listing links opened from chat stay inside the platform and do not open new
  external tabs unexpectedly.

### 4. Monitoring And Soak Verification

Enable production-style observability before the final launch decision.

Minimum metrics to watch:

- Request error rate by endpoint.
- p50/p95/p99 latency for `/api/chat`, image upload, auth callback, listings,
  conversations, and admin mutations.
- DeepSeek queue size, queue wait, active provider calls, provider failures, and
  provider timeouts.
- Database connection count and slow query symptoms.
- Memory and CPU.
- Realtime SSE connection count and reconnect/error behavior.

Minimum soak criteria:

- Run staging for at least 30-60 minutes with repeated realistic journeys.
- No steady memory growth.
- No queue growth that fails to drain.
- No database connection leaks.
- No spike of failed or incomplete AI responses.
- `/api/health` remains healthy during and after the run.

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
- `SMARTSTORE_IMAGE_STORAGE=s3` or `object`
- The matching S3-compatible storage credentials

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

Production readiness is high, but not 100 percent proven until the 93-95/100
gate above passes. The remaining risk is operational verification: provider
limits, storage credentials, OAuth credentials, real database behavior, mobile
Safari/PWA behavior, and monitoring under real traffic.
