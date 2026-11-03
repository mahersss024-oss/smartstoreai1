# Public Pages, Administrator Browser CI and Server API Contracts

The Production Gate runs public-page and administrator browser checks, server API
contracts, and native-helper/PostgreSQL contracts as separate required jobs.
Android/iPhone application binaries are built in the independent
mobile repository; neither Playwright browser project runs an installed native app.

## Required native and PostgreSQL contracts

`Mobile And PostgreSQL Contracts` checks out `mahersss024-oss/app` into `AI` at the
immutable commit recorded in `.github/workflows/production-gate.yml`. Update that
commit deliberately when validating a newer server/mobile pair. It installs both
lockfiles, runs the mobile application's full type/lint and helper test commands,
then executes the reviewed operation map with server, mobile and PostgreSQL results.
Chromium and its system dependencies are installed in this same job so the two
real React reconciliation checks have their browser prerequisite instead of skipping.
This job runs on every main push, pull request and manual workflow run; it does
not depend on the optional staging-database setting.

The mobile repository is private. The server repository secret
`MOBILE_REPO_DEPLOY_KEY` holds a dedicated SSH deploy key registered read-only on
the mobile repository. Checkout does not persist that credential. Fork pull requests
cannot read this secret and cannot pass this private-source check until run in a
trusted repository context; the workflow never uses `pull_request_target` to give
untrusted code access. The database and test processes receive no hosted secrets.

Its PostgreSQL 17 service is created for that job only. Port 55432 and database
`smartstore_codex_test` satisfy the existing integration-test destination guards.
The portable runner requires an explicit CI opt-in, verifies loopback destination,
database name and database-creation permission, applies committed migrations to
that test service, and runs all discovered PostgreSQL integration files sequentially.
The owner-reset test creates and drops its own randomly named temporary database.
No production or staging database secret is passed to this job. The existing
optional hosted staging job is retained separately.

`coverage/mobile-*.json`, `.md` and `.log` are uploaded with `always()` for 14 days.
They retain the actual named-test results and source fingerprints. Native-helper
tests use controlled module/provider fixtures; they do not exercise installed
Android/iPhone binaries, real OAuth sign-in, Cloudflare processing or native push
delivery. Those remain separate live/device checks.

## Final automated status

`Production Readiness` always evaluates the actual results of `quality`, `e2e`,
`api-contracts` and `mobile-contracts`. A failed, cancelled, skipped or missing
required result makes this final status fail. The optional staging job cannot
substitute for a failed required job and is not required for this status.

The separate `Promote Verified Production` workflow advances the `production`
branch only after a successful, trusted main-push gate run. It checks the run and
attempt, requires the final status, rejects stale main results and uses only a
fast-forward ref update. App Runner must watch `production` for this restriction
to govern deployment; an App Runner service watching `main` can still publish
before tests finish. Branch protection is a separate GitHub setting, not a side
effect of parsing this YAML. Applied settings, baseline revisions, live checks,
backup evidence and the rollback procedure are recorded in
[the prelaunch operations guide](prelaunch-operations.ar.md).

A successful status establishes the declared automated criteria for the tested
commit pair, not universal production readiness. Codemagic and native binary
publishing remain independent of the server promotion workflow.

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

The same gateway spec covers the existing customer resource URLs, safe native
handoffs, published sharing metadata and privileged read-only admin previews.
`admin-session.spec.ts` verifies the explicit admin entry, preserved auth return
destination, actual local cookie removal on logout, failed logout, revoked
sessions and browser back navigation. It never contacts a live identity provider.

The allowlist covers administrator presentation, users, workspace, evidence,
listing categories/car models, performance, and page access/rendering contracts.
`owner-market-reset.spec.ts` covers the owner-only reset preview, confirmations,
stale/expired previews, uncertain responses without automatic resubmission, and
revoked owner access on desktop and mobile. Reset requests are mocked; this
browser spec never deletes production data. Actual transaction behavior is
verified separately against a newly created disposable local PostgreSQL database.
The two inventory-driven specs select only `/admin` and paths beginning with
`/admin/`. Public policy documents are explicitly selected by `legal-pages.spec.ts`:
terms, privacy, listing rules, fees and account-deletion instructions. It checks
desktop/mobile light and dark reading, contrast, navigation, canonical URLs,
narrow screens, manual app opening and the external support-email request path.
It verifies that public deletion instructions send no account-delete request.
Native customer workflows and the retired full customer web interfaces are
outside these browser jobs. Their surviving URL gateways are covered above.
Offline and other public page journeys remain outside the current browser scope.

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
passed. Use the aggregate `Production Readiness` status as the required
branch-protection check; it requires both administrator browser projects, server
API contracts, quality checks, and mobile/PostgreSQL contracts to succeed. Remote
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
