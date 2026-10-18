# Browser CI Jobs

The Production Gate runs its complete Playwright suite in two independent
matrix jobs: desktop-chromium and mobile-chromium-layout. Each runner prepares
its own isolated test store and production build. No tests are excluded by
file, tag or title. The existing one-worker setting, retries, performance
budgets, per-test timeouts and 30-minute Playwright deadline are unchanged.

The job deadline is 45 minutes, with a 35-minute test-step deadline and a
five-minute artifact-upload deadline. This leaves setup time plus room to
collect reports after Playwright times out. Matrix fail-fast is disabled so
one project failing does not cancel the other. Failures still fail their jobs;
the quality and dependency-audit gates are unchanged.

The upload step uses `always()` to attempt saving playwright-report/ and
test-results/ on success, failure or cancellation. Artifacts are named by
project and run attempt and retained for 14 days. A hard runner termination,
forced cancellation, unavailable artifact service or missing output files can
still prevent preservation; this is not a guarantee against infrastructure loss.

Checks now appear as `Browser E2E (desktop-chromium)` and
`Browser E2E (mobile-chromium-layout)`. If branch protection required the old
`Browser E2E` name, update the required checks to both matrix job names. Remote
branch protection was not inspected or changed by this local task.

Local verification parses the workflow as YAML, checks project coverage and
deadline ordering, and lists the registered Playwright cases separately for
both projects. It does not execute GitHub Actions or claim remote CI success.

Verified locally on 2026-10-18: all three workflow contract tests passed;
targeted ESLint and TypeScript passed; Playwright listed 285 cases per project
(570 total in 20 files). No full browser rerun was necessary for this workflow-
only change. The subsequent removal of the braces dependency is documented
separately in `braces-security-mitigation.md`; the full audit gate is unchanged.
