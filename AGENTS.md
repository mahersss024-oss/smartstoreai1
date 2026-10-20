# SmartStoreAI / Souq Hamad

## Project map

- Arabic-first, RTL Saudi marketplace built with Next.js App Router, React,
  TypeScript, Tailwind CSS, the AI SDK and Prisma/PostgreSQL.
- `app/`: pages and API route handlers; `components/` and `hooks/`: browser UI.
- `agent/chat-agent.ts`, `agent/system-prompt.ts`, `agent/tools/`: Hamad's active
  instructions and tools; `app/api/chat/route.ts`: server chat orchestration.
- `agent/marketplace/repository.ts`: shared marketplace persistence and business
  operations; `agent/marketplace/store.ts`: development file/memory fallback.
- `lib/auth/`, `lib/security/`, `lib/admin/`, `lib/push/`, `lib/realtime/`: session,
  authorization, moderation, notifications and event delivery infrastructure.
- `lib/platform/policies.ts` and `agent/platform-guide.ts`: shared policy and
  operational help sources. `prisma/schema.prisma` and `prisma/migrations/`:
  database contracts. `tests/`: Node tests; `e2e/`: Playwright journeys.
- TypeScript imports use `@/*` from the repository root. Follow the surrounding
  module's conventions and preserve existing local changes.

## Product contracts

- Browsing is public. Account-bound writes require the verified Google or Apple
  session, and ownership/administrative permissions are enforced server-side.
  Derive the acting account from that session, never client-supplied ownership.
- A signed commission acknowledgement precedes sign-in. Sales completed through
  the platform owe 1% of the sale value. Marking sold creates a commission record;
  an unknown final amount remains pending. Preserve admin payment decisions and
  protect seller/admin updates against concurrent stale writes.
- Hamad currently has two roles: prepare owned unpublished drafts after the
  customer chooses conversational creation, and answer platform questions using
  verified help. Publication and other sensitive marketplace actions belong to
  customer-operated UI routes. Do not restore retired chat search, comparison,
  negotiation, payment or account-management tools from historical examples.
- Public market search uses the shared repository's literal normalized title
  search with explicit filters before pagination. Preserve its deterministic
  behavior; retained calculation services do not grant Hamad new capabilities.
- Model assessments are advisory. Human moderation decisions, authentication,
  ownership, blocked conversations and technical upload validation remain
  enforced. An assessment outage or concern creates review information rather
  than automatically deleting, suspending or rejecting customer content.
- Never invent listings, sellers, prices, availability, payment recipients or
  policies. Preserve Arabic/RTL usability and truthful product images. Keep
  private account/conversation state isolated when the signed-in user changes.

## Local commands

Use Node.js `>=22 <25` and the pinned pnpm `10.32.1`. On Windows PowerShell use
`pnpm.cmd` to avoid execution-policy conflicts with the PowerShell shim.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev
pnpm.cmd exec tsc --noEmit
pnpm.cmd lint
pnpm.cmd test
node scripts/test.mjs tests/route-access-contracts.test.ts
pnpm.cmd build
pnpm.cmd test:e2e --project=desktop-chromium
pnpm.cmd test:e2e --project=mobile-chromium-layout
pnpm.cmd test:db:integration
```

- `pnpm.cmd verify` runs types, lint, Node tests, build and dependency audit.
  Run checks appropriate to the change; distinguish passed, failed, skipped and
  unexecuted checks. Historical reports do not establish the current result.
- `scripts/test.mjs` provides a temporary marketplace data directory and isolated
  model provider by default. Database integration is opt-in and requires a
  configured disposable PostgreSQL database; it writes and cleans up fixtures.
- Playwright normally builds and starts its own fixture-backed server. Inspect
  inherited database/storage variables before running it: external settings can
  override its local fallback. `PLAYWRIGHT_BASE_URL` uses an existing server.
- `pnpm.cmd db:generate` generates Prisma Client. `db:migrate` creates/applies
  development migrations; `db:deploy` applies committed migrations; `db:push`
  directly synchronizes a schema. Use the intended database for each operation.
- Production uses `SMARTSTORE_MARKETPLACE_STORE=database`; file storage is a local
  fallback, not shared production persistence. Read variable names/defaults from
  `.env.example`; preserve existing secret files and configured values, never
  print credentials or replace them with example/test values.

## Documentation and verification context

Start with `README.md` and `docs/smart-marketplace-foundation.md` for orientation.
Some capability descriptions there are historical. For current behavior, consult
the implementation and these focused documents:

- `docs/hamad-role.md`: current assistant scope and retired tools.
- `docs/database-search-and-human-review.md`: search and human decision authority.
- `docs/database-production.md`: PostgreSQL, storage and production configuration.
- `docs/testing-coverage.md` and `docs/ci-browser-matrix.md`: test entry points and
  coverage boundaries.
- `docs/deep-review-2026-10-20.ar.md`: recorded security, concurrency and lifecycle
  findings plus reproduction limits. Recheck each finding against current code;
  it is a review snapshot, not proof that a finding remains or has been fixed.

Prefer behavioral regression tests for ownership, account changes, financial
state transitions and concurrency. Mocked providers do not verify live services;
file-store tests do not verify PostgreSQL transactions. Do not weaken a contract
or assertion solely to make an existing test pass.

## Development tools

- Follow `docs/agent-diagnostics-workflow.md` for discovery, minimal tool
  selection, read-only diagnostics and evidence-based verification. Tooling setup
  alone does not authorize product or production changes; follow the current task.
- Current tool status, including failed browser/trace checks, is recorded in
  `docs/environment-tools-verification-2026-10-20.ar.md`; do not infer readiness
  from installation alone.
- Browser tooling acceptance and the verified COOP-preserving trace method are
  documented in `docs/browser-tools-repair-2026-10-20.ar.md`. Use the local
  diagnostic scripts for repeatable checks and label prepared-context results.
- See `docs/codex-development-tools.ar.md` for installed MCP tools, account
  connections, verification results and VS Code setup.
- See `docs/local-postgres.md` for the isolated local PostgreSQL databases. Use
  `scripts/dev-tools/postgres.ps1` actions and the matching VS Code tasks for
  development and database integration; do not substitute the hosted database.
- Codex has Context7 and Playwright MCP configured in the user's Codex settings.
  Use Context7 when library documentation is needed, and Playwright when browser
  behavior matters. Verify tool availability in the current session first.
- GitHub and Sentry MCP require their account connections. Keep credentials out
  of source, prompts and logs. Installation does not authorize unrelated remote
  mutations; follow the user's task scope when acting through connected tools.
