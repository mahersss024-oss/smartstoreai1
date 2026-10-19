# SmartStore Load Tests

This folder contains load and flow tests for Souq Hamad. The tests are separate
from production code and do not change application routes, database schema, or
business behavior.

## Tools

- k6 is used for API, page, image, stress, spike, and soak tests.
- Playwright is used only for browser page metrics such as FCP/LCP/CLS, request
  counts, transfer size, and duplicate requests.

Install k6 from https://grafana.com/docs/k6/latest/set-up/install-k6/.

## Safety Defaults

Production writes are blocked by default.

Required environment:

```bash
K6_BASE_URL=https://staging.example.com
K6_ENV=staging
```

For production read-only checks:

```bash
K6_BASE_URL=https://souqhamad.com
K6_ENV=production
ALLOW_PRODUCTION_LOAD_TEST=true
pnpm test:load
```

Write flows require all of:

```bash
K6_ENV=staging
ALLOW_LOAD_TEST_WRITES=true
K6_SESSION_COOKIE="smartstore_session=..."
```

Never commit real cookies, tokens, or production credentials.

## Commands

```bash
pnpm test:load
pnpm test:pages
pnpm test:images
pnpm test:stress
pnpm test:spike
pnpm test:soak
pnpm test:browser
```

Useful overrides:

```bash
SMARTSTORE_LOAD_MAX_VUS=250 SMARTSTORE_LOAD_DURATION=10m pnpm test:stress
K6_LISTING_IDS=abc,def pnpm test:pages
K6_SEARCH_TERMS=camry,iphone pnpm test:load
```

Local functional smoke checks can use the existing isolated test server:

```bash
K6_BASE_URL=http://127.0.0.1:3123 K6_ENV=local pnpm test:load -- --vus 1 --iterations 1 --duration 10s
```

The runner forwards flags with or without an explicit `--` separator, including
the form pnpm forwards to package scripts. Confirm k6's printed execution plan
before interpreting a run. Stress stages honor `SMARTSTORE_LOAD_MAX_VUS` at every
step. A short single-user check is not a completed stress, spike or soak capacity
evaluation. Shared generator addresses/accounts can hit normal application rate
limits; do not disable those protections or relabel 429 responses as successes.

`pnpm test:ai-load` exercises documented platform help through the real chat route
and provider adapter. Its default mock transport calls `getPlatformHelp`, never
searches products or performs draft/sensitive actions. It parses the SDK message
stream, applies a deadline through response consumption with an elapsed-time
postcondition for a busy event loop, and exits unsuccessfully
for failed/incomplete/unavailable replies or an empty level set. Failed levels
stop further escalation. A provider outage
is a failure even when the route safely returns a completed HTTP 200 explanation.
`AI_LOAD_PROVIDER_STATUS` injects mock provider errors for regression checks only.

The isolated provider preloader blocks live provider calls by default. The shared
platform-help fixture is opt-in and requires all three environment values:
`CI=1`, `DEEPSEEK_API_KEY=test-model-placeholder`, and
`SMARTSTORE_TEST_MODEL_FIXTURE=platform-help`. It is test-only and does not change
application model configuration or provide evidence of live semantic accuracy.

Image checks fail when the selected listing sample contains no images or an image
URL returns a non-image content type. Public image requests never include the
test session cookie, including requests to external image hosts. The isolated
E2E seed can include local public-image samples with `SMARTSTORE_LOAD_FIXTURES=1`;
this opt-in flag does not alter normal fixtures or production data.

## What Is Covered

- Public marketplace browse and search.
- Listing detail and seller profile navigation.
- Image delivery through thumbnail/display/original URLs returned by APIs.
- Auth/session endpoints using optional test cookies.
- Chat endpoint documented platform-help flow with explicit session cookie and completed-reply checks.
- Safe unpublished manual draft creation using a valid catalog category, never publication.
- Document-navigation browser metrics for the configured core pages. The main E2E suite separately covers internal navigation, reload and back restoration.

## Stop Conditions

Stop escalation when any of these persist:

- Error rate is above 2%.
- p95 is above the scenario threshold.
- 502, 503, or 504 responses increase.
- Database connections exceed 85-90%.
- CPU, memory, RDS latency, or queue depth degrade.
- Timeouts, restarts, or connection failures appear.

## Reports

k6 writes JSON summaries to `tests/load/reports/` when `K6_REPORT_FILE` is set
by the runner. Browser tests write `browser-page-flow-<project>.json` in the same
folder so desktop/mobile reports cannot overwrite each other. Browser LCP and CLS
come from the same buffered PerformanceObservers used by the page-vitals suite,
not unsupported `performance.getEntriesByType` calls. They use a bounded 1-second
post-load observation window rather than waiting for realtime connections to idle.
Browser load artifacts use `coverage/browser-load-artifacts`, separate from the
main E2E output, so starting this suite cannot delete another run's trace files.
Run timing suites without concurrent builds, coverage, lint or load generation;
separate artifact directories do not remove CPU contention between processes.

The final capacity number must come from measured staging runs. Do not infer
capacity from local runs.
