# Shared Marketplace Text Understanding

The server uses one shared text-analysis task through the existing DeepSeek
`search` profile (`DEEPSEEK_SEARCH_MODEL`, then the provider's existing defaults).
Classification does not provision or call a separate classification model.
Vision still requires the existing image-capable model; arithmetic stays in
the ranking, pricing, market-intelligence and negotiation engines.

## Output and Reuse

The validated result contains an existing catalog category, product identity,
whole-product/part/accessory/bundle distinction, brand/model/configuration,
contextual equivalents, structured search filters, intent and policy decision.
All category descriptions are supplied from the actual catalog. Unknown IDs,
invalid output and duplicate/missing batch IDs are rejected. User text is data,
not instructions. Confidence is self-reported, not a calibrated accuracy score.

Identical in-flight text is shared. Successful results are cached for ten
minutes, failures for fifteen seconds, with 1024 hashed keys and at most sixteen
active analyses per process. Text is limited to 12000 characters and requests
have a six-second deadline, cancellation and no SDK retries. Independent texts
queued together are batched in groups of up to eight; results are matched by ID.
An individual timeout does not cancel another active batch participant.
Preparing a candidate set has a shared six-second budget, rather than a full
timeout for every candidate. Cache entries are process-local, not database rows
or a cache shared across App Runner instances. Provider usage can incur charges.

## Runtime Paths

- Manual classification delegates to shared text analysis; explicit categories
  remain the seller's choice.
- Public search and chat search consume model filters and equivalents. Matching
  and numeric ranking remain deterministic. If analysis is unavailable, literal
  normalized text matching is used without guessing a category or synonyms.
- Explicit chat refinement retains model equivalents with existing search-state
  JSON; independent searches clear previous constraints and equivalents.
- Similar listings, comparison, pricing and similar-listing follow notifications
  use prepared semantic product identities to choose comparables. Unknown or
  low-confidence identity is not evidence of a comparable. Price calculations
  and adjustments are unchanged and never replaced with generated market data.
- Draft creation/edits, administrative content edits and conversation messages
  use contextual policy analysis rather than forbidden-word/root matching.
  Unavailable text inspection produces review, not an invented approval. Drafts
  awaiting policy review cannot be published through the ordinary seller flow.
- Chat can reuse a confident analyzed intent; conversation-dependent clarification
  still uses the existing contextual router when necessary. Sensitive actions
  remain user-interface-only under the server tool boundary.
- Vision reads expected categories from prepared text context or supplied listing
  fields and receives the real category catalog. Low resolution/lighting/clarity
  and category mismatch alone are advisory, not publication conditions. Genuine
  prohibited content remains blocked; technical image validation remains intact.

The six legacy lexical modules and their dictionary-specific product tests have
been removed. Category and policy contract tests now exercise shared-analysis
results rather than the retired word lists. This does not claim all regexes are removed:
technical validation, normalization, numeric parsing and UI routing still use
code. No schema migration or new table was added.

## Verification Scope

On 2026-10-18, 140 focused tests passed across eighteen test files. These are
targeted checks of the changed paths, not a claim that the full project test
suite or all browser journeys were run for this change.
The production build, including TypeScript checking, and targeted ESLint also
passed. All changes remain local and unpushed.

Focused tests exercise mocked provider transport, shared cache/in-flight reuse,
failure/timeout handling, category validation, contextual equivalents, search
reset/refinement, product/part separation, actual price arithmetic, image advice,
ownership and client route lifecycle. Contextual fixtures are explicit test data,
not a production synonym dictionary. They verify integration, not live-model
semantic accuracy. No production database mutation, paid live evaluation or
deployment is part of this verification. A representative live-model evaluation
is still required before claiming semantic accuracy or production latency.
