# Chat Customer Experience Contract

> Current role: [Hamad: Drafts And Platform Help](hamad-role.md). The search,
> comparison and pricing chat flows below describe previous implementations and
> historical verification, not the capabilities currently exposed to Hamad.

## Responsibilities

The existing chat, scope, search/text-analysis, moderation and vision model
profiles remain independently configurable. No model names, pricing calculations,
database tables or public API routes are replaced by this change.

Marketplace text understanding is reused for intent and scope when sufficiently
confident. Unknown requests are not classified through product dictionaries or
concatenation of earlier requests. The contextual router can ask for clarification.
Policy assessments are advisory; explicit human moderation and technical
permissions remain authoritative.

## Customer Search

- Search uses published database titles and explicit constraints only.
- Brand and model are literal title constraints, not inferred synonyms.
- Independent searches reset state. Refinement retains previous constraints;
  `clearFilters` explicitly removes constraints and `anywhere` clears a prior city.
- Geographic distance is not available and must never be claimed as calculated.
- Rewriting an answer preserves verified search results. An explicitly empty
  newer search must not revive older matches.

## Replies and Operations

Arabic-only generated prose is preserved. A response containing Latin names is
rewritten without tools; it is not allowed to repeat draft writes or searches.
Output review receives verified tool results as data for factual checking.
Provider failures use static Arabic wording and preserve verified result cards.
A completed draft operation is reported as saved rather than falsely reporting
that nothing changed.

Standard UI message IDs identify customer turns. Draft operation slots derive
stable row IDs from the authenticated user and turn, using the existing Listing
primary key and serializable writes for replay protection. New turns remain
independent. Legacy API callers without message IDs do not get turn-level replay
protection. Concurrent model retries can order multiple draft slots differently;
customers must still review each draft before manual publication.

Chat draft images use content-derived IDs scoped to the listing, avoiding repeat
attachments. Content inspection uses a bounded, model-specific process-local
cache (ten minutes for completed assessments, ten seconds for outages). This
does not promise cross-instance caching. Metadata-only tools never claim measured
lighting, sharpness, relevance or a visual-quality score. Zero in the legacy
storage field means unmeasured; tool responses use null.

## Verification

### Account, Context And Image Isolation

The in-tab chat snapshot is scoped to the authenticated user. A committed logout
or account switch clears it before painting, and old-owner writes cannot populate
another account's snapshot. The client uses an owner-specific chat instance and
stops active requests when that instance changes or the home page unmounts.
Requests identify their chat owner; a mismatch with the authenticated session is
rejected before model processing. Ownership changes notify other tabs through
BroadcastChannel and a storage-event fallback, carrying only a random signal,
never an account or token. Recipients hide private chat while verifying the
actual server session. Focus, visibility and page restoration also revalidate
the session without periodic or per-navigation polling. Versioned requests stop
a delayed verification from restoring identity after logout or a newer check.

First-party chat requests have an account-scoped conversation identifier. The
identifier survives in-app navigation, is different in each tab/device, and is
rotated on a new chat. Search refinements and resets address that conversation's
existing search-state row, not another conversation for the same account. Realtime
search notifications retain authenticated-user visibility and are matched to the
current conversation. Reset requests also verify the browser's account owner.
Legacy API callers without conversation IDs retain their original search namespace.
No new table, migration or model is introduced.

The visible conversation remains intact while client and server select complete
recent turns within the existing 40-message and 24,000-text-character budgets.
An oversized latest message is still rejected, not silently shortened. Older
photos become source references rather than being resent inside every old turn.
This is a recent-context window, not a promise of unlimited model memory; saved
drafts and persisted search constraints remain the authoritative structured state.

The interface no longer guesses intent, product changes or refinements from word
lists. Search cards follow verified tool outputs; seller fallback presentation
uses server intent metadata. Uploaded photos require explicit zero-based indexes
and their source message ID. Missing selection means a photo-free draft. Earlier
uploads must be explicitly selected for the same product, and photos claimed for
one draft cannot be copied into another draft during the same tool execution.
Per-image product descriptions from the existing visual assessment help the model
map pictures to products; uncertain mappings require clarification. No new model,
table, route, publication permission or image-resolution requirement is added.
The bounded visual-assessment cache is keyed per image, model and media type, so
selecting already-inspected subsets for separate drafts does not inspect them again
within that process and cache lifetime.

Verified database search/comparison cards are streamed as soon as their tool
finishes. Generated prose still waits for Arabic validation and output review;
rewriting remains answer-only. A provider failure after search retains the actual
cards. This reduces the wait for cards, not the model provider's generation time.

Targeted tests exercise the real chat route with a fully intercepted provider,
including Arabic rewriting, checker outages and provider failure after a saved
draft, plus a replay of the same customer turn. Browser tests exercise desktop
and mobile cards, empty-result replacement, manual classification and public
title search. No live provider accuracy, production database, R2 integration or
production load was measured. Model confidence is not an accuracy benchmark.

### Conversation Isolation Follow-up: 2026-10-19

- 76 focused source tests passed with no failures or skips, including conversation
  key ownership, independent search refinements/resets in memory and a simulated
  database delegate, malformed IDs, stale-owner reset rejection and the real chat
  route's scoped search and authenticated realtime delivery.
- All 16 desktop/mobile Chromium cases passed against the updated production
  build. They cover independent tabs, ID restoration on navigation, ID rotation
  on a new chat, cross-tab logout through each notification transport separately,
  account changes on focus and delayed-session response races, alongside long
  conversations and early-result dismissal. The startup and hydration-wait
  failures encountered during development were resolved and the final run passed.
- Production build/type checking, scoped ESLint and whitespace checks passed.
  This is focused local verification with intercepted providers and isolated
  fixtures, not a full-suite rerun, live database/model accuracy or load testing.
  Changes remain local and have not been pushed.

### Focused Gate: 2026-10-19

- 189 focused source tests passed with no failures or skips, covering chat,
  ownership, context limits, explicit image selection, cached image subsets,
  output review, literal search, pricing and private negotiation boundaries.
- 16 desktop/mobile Chromium cases passed against the production build,
  including 22-exchange conversations, logout without a document reload,
  early-card dismissal before a delayed answer, navigation and independent
  manual publication. Screenshots were inspected for desktop and mobile.
- Production compilation/type checking, scoped ESLint and whitespace checks passed.
- This was focused local verification with intercepted model transport, not a
  rerun of the full project suite or a live-provider, production database or
  production-load assessment. No schema, migration, dependency or model-profile
  changes are included, and these changes have not been pushed.

### Local Gate: 2026-10-18

- `pnpm test`: 765 passed, zero failed. The 15 database cases are opt-in in
  this run and were executed separately, not counted as successful skips.
- `pnpm test:db:integration`: all 15 passed against a disposable loopback-only
  PostgreSQL 17 cluster with existing migrations. This exposed and verified a
  fix for concurrent publication returning a false missing-record result while
  preserving concurrent human moderation decisions.
- Desktop and mobile Chromium together: all 576 applicable browser cases
  passed after rechecking failures; two project-specific cases do not apply to
  the opposite project. Projects were completed separately to respect the
  combined run's global timeout.
- The final complete timing run passed 209 cases, with one opposite-project
  skip. It measured 26 routes at four sizes in both Chromium projects: 208
  page samples. Maximum LCP was 1364 ms, maximum CLS was 0.06138 (rounded up),
  and maximum sampled interaction latency was 152 ms. No horizontal overflow
  or client JavaScript errors were recorded in these page samples.
- Trace screencasting inflated presentation delay during laboratory input
  samples. Timing-only specs now disable trace capture while keeping the
  original budgets, trusted interactions, metric attachments and screenshots
  taken after measurement. Functional specs retain their diagnostic traces.
  Experimental visual changes were discarded; the existing navigation and
  conversation-list appearance remain unchanged.
- Test runners use synthetic provider credentials and a test-only transport
  interceptor. Unmocked model requests return a local test error rather than
  reaching the live provider. Provider scenarios install explicit mocks.
- `pnpm audit --audit-level moderate`: no known vulnerabilities found.
- TypeScript, full ESLint and the production build passed. No package lockfile,
  database schema, migration or model-profile changes are included.

These are isolated local checks, not field Web Vitals, a physical iPhone/Safari
test, a live model accuracy evaluation, or an AWS/RDS/R2 production or load test.
