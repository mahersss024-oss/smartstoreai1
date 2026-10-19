# Listing Category Model

Automatic listing classification now delegates to the shared server-side text
analysis task, not product keyword matching. See
[Shared Marketplace Text Understanding](marketplace-text-understanding.md).

It uses the existing DeepSeek connection/key and `search` profile, including
`DEEPSEEK_SEARCH_MODEL`. No separate classification model is configured or
provisioned. A classification request can reuse the full text-analysis result.

The authenticated `POST /api/marketplace/listing-category` accepts title and
description only. Requests are bounded to 24KiB, 140 title characters and 4000
description characters, and rate-limited to 20 requests per user per minute.
Model responses must match an existing category ID or null and confidence in
the range 0..1. Scores below 0.8 yield an uncertain result, not a guessed
category. Model confidence is self-reported, not a calibrated accuracy metric.

The manual form places description immediately after title and sends both to
the same existing classifier. Title identifies the offer and description adds
context. Changes to either field refresh automatic suggestions; manual choices
remain authoritative. Cached results are keyed by both fields.

Optional `categoryOption` must belong to the suggested category. For cars only,
optional `carModel` must belong to that selected brand in the shared car-family
catalog. Invalid dependent choices are omitted without inventing substitutes.
Both analysis and classifier cache keys include the catalog, so catalog updates
cannot reuse an obsolete selection. This uses the same existing model task, not
another inference step. Customer selection always takes precedence.

Client suggestions wait 900ms after typing stops. Editing the text clears the
previous automatic suggestion; aborted or stale replies cannot overwrite new
text or a manual selection. Blur does not trigger duplicate calls. The UI
shows loading, uncertain and unavailable states while retaining manual choice.

The server has a six-second deadline with cancellation and no SDK retries.
Completed results are cached in a bounded process-local map (256 hashed keys,
five-minute TTL), and identical in-flight requests are shared (maximum 32).
The cache is not persistent or shared across server instances. Failures are
not cached, and no raw listing text is written to failure logs by this service.
Model calls consume the existing provider's quota and may incur charges.

The asynchronous repository draft creation path applies the same model when
`autoCategory=true`, including drafts created through marketplace tools. An
unavailable or uncertain result falls back to `other`, never the former keyword
rules. With `autoCategory=false` or omitted, the provided category is preserved
without classification inference. Repository writes still prepare shared
contextual text-policy analysis. Synchronous storage never invokes inference
or changes an existing draft's category.

Verification uses injected model responses and mocked provider HTTP calls, not
paid live inference. Tests cover output validation, timeouts, unavailable states,
deduplication/TTL, manual bypass, authenticated API/rate limits, repository
publication, debounce and stale-response protection. These checks verify the
integration and contracts; real semantic accuracy still requires evaluation
against representative titles with the selected live model.

Earlier classification-only verification on 2026-10-18: 140 related unit/route/provider tests passed;
6 focused browser cases passed across desktop and mobile Chromium. TypeScript,
targeted ESLint and the production build passed. Browser tests used an isolated
file store and intercepted classifier responses; the provider integration test
mocked HTTP. No live-model accuracy evaluation or deployment was performed.
These changes remain local and unpushed.
