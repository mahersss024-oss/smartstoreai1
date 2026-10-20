# Diagnostic workflow

This workflow follows the user's environment-setup instructions. It does not
authorize changes to application behavior, design, routes, schema, migrations or
production infrastructure. Keep existing local changes intact.

Before an implementation, trace the requested behavior through existing usages,
imports, dynamic references, routes, validation, repository operations, models
and relevant tests. Establish the current behavior, then make the smallest
authorized change and verify it with appropriate types, lint, tests, build and
browser evidence. A build alone does not prove functionality; unit tests alone
do not prove the browser experience.

Use the smallest useful tool set:

| Task | Tools |
| --- | --- |
| Type or compile problem | Search, TypeScript, Git diff |
| UI behavior | Search, Playwright; DevTools when its browser connection works |
| API problem | UI-to-response trace, Network, backend logs, read-only DB metadata when needed |
| Suspected unused code | Knip, static/dynamic references, route/config discovery, Git history and runtime evidence |
| Performance | Existing browser-vitals helpers, valid DevTools/Lighthouse measurements and relevant server metrics |
| Database problem | UI/API/repository/schema trace, then catalog reads through the inspection script |
| Production or Native | Only tools needed for an explicitly scoped current task |

Treat Knip output as candidates. Classify each reviewed item as A used, B dynamic,
C suspected or D high-confidence unused. Retain evidence and never delete code
merely because the tool flags it. This inspection task authorizes no removals,
automatic lint fixes, forced audit fixes or major dependency upgrades.

Use existing package scripts and the pinned pnpm. Check tools and versions before
installing. The isolated audit installer writes only under `.data/` and does not
modify the application's manifest or lockfile. Do not add overlapping MCP tools
without a concrete diagnostic need.

GitHub is project-scoped to read-only tools. Database inspection defaults to a
read-only transaction with fixed catalog queries; its existing local login still
has broader privileges. Do not run migrations, tests that write to a real DB,
DML/DDL, production changes, AWS/IAM mutations or GitHub writes under an
inspection-only task. Ask for the user's explicit authorization before those
actions, destructive operations, or new writes outside the project. Never print
secrets or connection strings or change secret files to example values.

Record Installed, Configured, Connected and Tested separately, including the
actual test, version, result and limitations. A tool listed by Codex has not
necessarily connected to its backend. Failed/partial traces are not performance
scores. Preserve baseline failures instead of weakening tests to hide them.

Current results and artifacts are documented in
`docs/environment-tools-verification-2026-10-20.ar.md`.

For repeatable local browser diagnostics, use
`node scripts/dev-tools/devtools-local.mjs <HTTP-loopback-URL>` and
`node scripts/dev-tools/lighthouse-local.mjs <HTTP-loopback-URL>`, or their
VS Code tasks. They require an already-running isolated test app, reuse the
pinned tools, and save evidence under `.data/browser-diagnostics/`.

The verified collection method preserves COOP: prepare the page's browsing
context, then explicitly reload while tracing. For MCP, start with
`reload=false, autoStop=false`, navigate with `type=reload, ignoreCache=true`,
then stop. Lighthouse uses the existing Page and `skipAboutBlank=true` with
storage reset enabled. Require the intended origin/path and actual navigation
metrics before accepting a trace. Label results as prepared-context desktop
lab samples; never treat `NO_NAVIGATION`, null scores or TBT as field INP.
See `docs/browser-tools-repair-2026-10-20.ar.md` for the controlled reproduction,
successful acceptance and limits. Do not weaken browser security or application
headers to work around a measurement failure.
