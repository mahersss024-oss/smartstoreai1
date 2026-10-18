# All-Page Laboratory Vitals Audit

Date: 2026-10-18 (Asia/Riyadh). Tested application commit: `fcca7a2`.
Test additions and this report are local and have not been pushed.

## User-Page Fix Verification

The user subsequently requested fixing the mobile CLS failure below. The
statistics section in `app/admin/users/page.tsx` now reserves its grid geometry
before pagination arrives, with fixed minimum value-line heights. While data
is unavailable it is invisible, aria-hidden and contains no numeric values;
actual counters appear only after the response. Queries, authorization,
mutations and data sources were not changed.

The focused post-fix performance run passed on all four viewports:

| Viewport | CLS after fix | LCP (ms) | Sampled interaction maximum (ms) |
| --- | --- | --- | --- |
| 320x568 | 0 | 264 | 32 |
| 390x844 | 0 | 288 | 32 |
| 820x1180 | 0 | 576 | 48 |
| 1440x900 | 0 | 336 | 16 |

Four controlled delayed-response tests additionally verify hidden/empty
counters before data, real counts after data, and an unchanged filter position
within 1px. Existing save-contract and protected-user preview browser checks
also passed. The first focused browser run passed 9 of these 10 cases; the
remaining desktop loading test used a hidden mobile-menu locator. Correcting
the test to select a visible header button and rerunning that case passed
against the same production build. All 10 distinct focused cases therefore
have passing results, not a single all-green 10-case invocation.

The 33 existing admin user-management tests, targeted ESLint and TypeScript
checks passed. The production build passed before the browser checks. An
initial build caught a null pagination access introduced during the edit;
that was corrected before the successful build and measurements.

Post-fix artifacts:
`C:\Users\maher\AppData\Local\Temp\smartstore-users-cls-fix-20261018`

This was a focused recheck of the changed page, not another 104-case full run.
The original measurements and failures below are retained as historical
evidence. Neither the fix nor the test additions have been pushed.

## Original Audit Result (Before Fix)

All 26 `app/**/page.tsx` routes were discovered from the existing source
inventory and measured at 320x568, 390x844, 820x1180 and 1440x900.
The full run completed 104 cases: **102 passed, 2 failed, 0 skipped**.
Every case produced an LCP reading and Event Timing interaction samples.

The two failures are the same route, `/admin/users`, at mobile widths:

| Viewport | CLS | Required | LCP (ms) | Sampled interaction maximum (ms) |
| --- | --- | --- | --- | --- |
| 320x568 | 0.3114 | <= 0.1 | 240 | 32 |
| 390x844 | 0.2517 | <= 0.1 | 260 | 56 |

This is a layout-stability failure during loading, not a page crash or
authorization failure. The route passed the tablet and desktop cases.
No product fix or relaxed threshold was applied as part of this audit.

A second run with a fresh production build reproduced both mobile failures:
CLS 0.3114 at 320x568 and 0.2517 at 390x844. The same page passed again at
820x1180 and 1440x900. The existing multi-page administrative presentation
test also passed after extracting its unchanged fixtures into a shared helper.
That focused recheck completed 5 cases: 3 passed, 2 failed. Both failures
were exclusively the mobile CLS assertions above, not application exceptions.

Across all 104 cases:
- LCP maximum: 1,216 ms; all readings <= 2,500 ms.
- Sampled interaction maximum: 104 ms; all readings <= 200 ms.
- CLS maximum: 0.3114; two readings exceeded 0.1.
- No uncaught page errors or HTTP >=400 API responses were observed.
- All main document responses were 200 and remained on the intended path.
- No document-level horizontal overflow exceeded 1px.
- Screenshots were saved for every case; failure traces were retained.

## Per-Route Results

Each value below is the maximum across the four tested viewport sizes.
Interaction values describe the sampled keyboard interactions, not field INP.

| Route | LCP (ms) | CLS | Interaction maximum (ms) | Result |
| --- | --- | --- | --- | --- |
| `/account/follows` | 644 | 0.0153 | 56 | PASS |
| `/account/listings` | 272 | 0.0000 | 104 | PASS |
| `/account` | 492 | 0.0000 | 56 | PASS |
| `/account/seller-profile` | 376 | 0.0000 | 80 | PASS |
| `/admin/audit-log` | 644 | 0.0074 | 48 | PASS |
| `/admin/commissions` | 292 | 0.0000 | 48 | PASS |
| `/admin/listings` | 284 | 0.0006 | 48 | PASS |
| `/admin/maintenance` | 528 | 0.0004 | 72 | PASS |
| `/admin/moderation` | 288 | 0.0175 | 48 | PASS |
| `/admin` | 928 | 0.0000 | 64 | PASS |
| `/admin/users` | 664 | 0.3114 | 56 | FAIL: mobile CLS |
| `/commission-agreement` | 280 | 0.0000 | 56 | PASS |
| `/commission-policy` | 308 | 0.0000 | 80 | PASS |
| `/commissions` | 288 | 0.0000 | 72 | PASS |
| `/conversations/[conversationId]` | 596 | 0.0007 | 64 | PASS |
| `/conversations` | 264 | 0.0000 | 64 | PASS |
| `/delete-account` | 316 | 0.0000 | 64 | PASS |
| `/favorites` | 268 | 0.0000 | 88 | PASS |
| `/listing-policy` | 308 | 0.0000 | 64 | PASS |
| `/listings/[listingId]` | 700 | 0.0000 | 64 | PASS |
| `/notifications` | 488 | 0.0614 | 88 | PASS |
| `/offline` | 268 | 0.0000 | 48 | PASS |
| `/` | 1216 | 0.0001 | 104 | PASS |
| `/privacy` | 368 | 0.0000 | 80 | PASS |
| `/sellers/[sellerId]` | 412 | 0.0000 | 56 | PASS |
| `/terms` | 332 | 0.0000 | 64 | PASS |

## Method And Limits

The official Playwright webServer built and ran Next.js in production-build
mode on localhost:3133 with isolated file-store seed data. Client API fixtures
were mocked; the listing and seller documents used locally seeded server-side
data. Administrative fixtures were reused from the existing presentation
suite. No production database, real user account or paid AI call was used.

The Chromium desktop project was resized to four viewports. These are viewport
layout checks on the local machine, not physical-device benchmarks, mobile CPU
emulation, slow-network measurements or user-population percentiles.

Each case waits for app hydration, fonts and network idle plus one second,
then performs six trusted Tab key interactions without activating commands.
The browser Event Timing observer records the maximum reported duration for
this short sample. These values are a limited laboratory responsiveness check;
they do not exercise every handler, menu, edit operation or user workflow.
No missing observation is converted into a zero-valued success.

CLS uses the maximum session-window score, excluding shifts following recent
input. LCP is collected before keyboard input. The observation window does not
establish stability throughout an arbitrarily long session. INP is best assessed
using realistic interactions and field measurements; see the primary
[INP measurement guidance](https://web.dev/articles/inp).

One signed-in state was tested per route: owner for administration and user for
other pages. This audit does not enumerate guest screens, every authorization
role, empty/populated combinations, dialogs or error states. Some client data
sets are deliberately small or empty. Image fixtures are not a measurement of
production R2 delivery. The offline page was rendered normally, not tested as
a full disconnected network journey. `/splash` serves an SVG image, not a page,
and is outside this page-document inventory.

TypeScript and targeted ESLint checks passed for the new test support files.
A temporary readonly-array type error in the initial test harness prevented
the first startup; it was corrected before the 104-case run. A favorite fixture
was also corrected to the existing response shape; no application contract
was changed.

## Reproduction And Evidence

Run locally with the repository's isolated Playwright webServer:

```powershell
pnpm test:e2e e2e/all-pages-vitals.spec.ts --project desktop-chromium
```

Source: `e2e/all-pages-vitals.spec.ts`.
Observers: `e2e/helpers/page-vitals.ts`.
Shared administrative fixtures: `e2e/helpers/admin-presentation-fixture.ts`.

Detailed artifacts are outside the repository:

`C:\Users\maher\AppData\Local\Temp\smartstore-all-pages-vitals-20261018`

`results.json` is the structured Playwright report; `run.log` contains each
page's metrics. The `artifacts/` directory contains per-case metrics attachments
and screenshots plus traces for failures. Rechecks use separate files and
artifact directories so the initial evidence is preserved.
