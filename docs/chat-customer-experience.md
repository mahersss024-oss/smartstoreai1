# Chat Customer Experience Contract

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

Targeted tests exercise the real chat route with a fully intercepted provider,
including Arabic rewriting, checker outages and provider failure after a saved
draft, plus a replay of the same customer turn. Browser tests exercise desktop
and mobile cards, empty-result replacement, manual classification and public
title search. No live provider accuracy, production database, R2 integration or
production load was measured. Model confidence is not an accuracy benchmark.

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
