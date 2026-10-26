# Public Pages, Administrator Browser CI and Server API Contracts

The Production Gate runs public-page and administrator browser checks and server API contracts
as separate jobs. Android/iPhone application binaries are built in the independent
mobile repository; neither Playwright browser project runs an installed native app.

## Administrator browser scope

`Browser E2E (desktop-chromium)` and `Browser E2E (mobile-chromium-layout)` run an
explicit allowlist of administrator UI specs. The mobile project emulates a
mobile browser viewport. It does not run the Expo application.

The public `/` app download gateway is also covered by the explicit
`app-download-gateway.spec.ts` allowlist entry in both projects. It verifies the
unpublished state, desktop QR, Android/iPhone selection, and a captured manual
`smartstore://` handoff without launching an OS application. Store URLs are empty
in the isolated web server fixture. The page never automatically redirects; its
QR points to `https://souqhamad.com/`, and mobile visitors choose their action.
This does not establish native installation or actual store availability.

The allowlist covers administrator presentation, users, workspace, evidence,
listing categories/car models, performance, and page access/rendering contracts.
The two inventory-driven specs select only `/admin` and paths beginning with
`/admin/`. Public policy documents are explicitly selected by `legal-pages.spec.ts`:
terms, privacy, listing rules, fees and account-deletion instructions. It checks
desktop/mobile light and dark reading, contrast, navigation, canonical URLs,
narrow screens, manual app opening and the external support-email request path.
It verifies that public deletion instructions send no account-delete request.
Customer account, market, listing-detail, seller, offline and
other public page journeys are outside the browser jobs' current scope.

The administrator performance fixture intercepts telemetry rather than consuming
the shared test server's per-IP visit quota. It still verifies that the browser
sends the visit's POST payload. API response failures, browser exceptions, layout
overflow, LCP/CLS and sampled interaction budgets remain asserted. Rendering
readiness uses the application's ready marker, fonts and images, rather than
waiting for all background network connections to stop. These fixtures do not
prove service-worker, real-provider, or production infrastructure behavior.

## Independent request-only API scope

`Server API Contracts` runs the `api-contracts` Playwright project without a
browser installation. It selects only:

- `e2e/api-contracts.spec.ts`: supported HTTP methods, unsupported-method rejection,
  unauthenticated rejection, and customer denial at staff-only APIs.
- `e2e/listing-reference.spec.ts`: authenticated draft creation, identifier format,
  draft state, and exclusion of unpublished records from public search.

Both files use Playwright's request fixture and explicitly refuse non-loopback
test targets. Browser page/context fixtures are prohibited by the local workflow
contract test. APIs used by the native app retain these independent contracts;
removing customer web journeys does not remove server authorization checks.

## Isolation, deadlines and reports

Each CI runner prepares its own temporary file store and production build.
Playwright probes `/api/health` for server readiness. The browser matrix is kept
separate from the API project, and matrix fail-fast is disabled. A failure in
either browser job does not cancel the other browser job or the API job.

Server preparation has a five-minute budget because it includes fixture setup
and a full production build on a cold machine. The previous two-minute budget
timed out locally before the health endpoint became ready. Per-test and assertion
limits remain unchanged; this does not hide a build failure or a test timeout.

The one-worker setting, configured retry behavior, per-test limits and 30-minute
Playwright deadline are unchanged. Each job has a 45-minute deadline, a
35-minute test-step deadline, and five minutes reserved for artifact upload.
Failures still fail their jobs. The quality, unit/integration-safe test,
production build and dependency-audit gates remain enabled.

Report upload runs with `always()` after success, failure or cancellation. Browser
artifacts are named by project and run attempt; API reports use
`playwright-api-contracts-<attempt>`. Reports and traces are retained for 14 days.
Hard runner termination, infrastructure failure or absent output may still
prevent artifact preservation.

## Local checks

```powershell
node scripts/test.mjs tests/ci-browser-matrix.test.ts
pnpm.cmd test:e2e --project=desktop-chromium
pnpm.cmd test:e2e --project=mobile-chromium-layout
pnpm.cmd test:e2e --project=api-contracts
```

The workflow contract test parses YAML, verifies browser/API selection and
deadline/report protections, and checks that API specs have no browser fixtures.
Use Playwright's `--list` to inspect registered cases without running them.
These local checks do not establish that GitHub Actions or a native-device build
passed. Required branch-protection checks should include both administrator
browser names, `Server API Contracts`, and the existing quality gate. Remote
branch protection is not changed by this source configuration.

Verified locally on 2026-10-25 against an isolated production build and test store:
67 desktop administrator cases, 66 mobile administrator cases, and 66 request-only
API cases passed with retries disabled (199 passed, zero failed, one skipped,
8.8 minutes). The existing performance audit intentionally runs only in the desktop
project because it sets mobile/tablet viewports internally; it passed there and
was skipped in the mobile project. All five workflow contract tests, TypeScript,
and targeted ESLint passed. These are local results, not a remote CI result.

Release validation on 2026-10-26 included the new app gateway and ran all three
projects together against one isolated production build: 205 passed and one
intentional mobile duplicate of the desktop performance audit was skipped
(206 total, 10 minutes, no failing tests). The first startup attempt exceeded
the former 120-second production-build budget; the rerun with the five-minute
preparation budget passed. All five workflow contracts passed after that change.
The full Node run passed 871 tests with 19 database cases skipped in that run;
all 19 were then executed successfully against the dedicated local PostgreSQL
test database. No production database was used or modified.
