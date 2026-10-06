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
K6_MAX_VUS=250 K6_DURATION=10m pnpm test:stress
K6_LISTING_IDS=abc,def pnpm test:pages
K6_SEARCH_TERMS=camry,iphone pnpm test:load
```

## What Is Covered

- Public marketplace browse and search.
- Listing detail and seller profile navigation.
- Image delivery through thumbnail/display/original URLs returned by APIs.
- Auth/session endpoints using optional test cookies.
- Chat endpoint read-like request flow with explicit session cookie.
- Realtime SSE connection behavior with short-lived connections.
- Safe write smoke flow for staging only.
- Browser navigation metrics for cold, warm, internal navigation, refresh, and back.

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
by the runner. Browser tests write `browser-page-flow.json` in the same folder.

The final capacity number must come from measured staging runs. Do not infer
capacity from local runs.
