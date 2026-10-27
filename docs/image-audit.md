# Image delivery audit

| Surface | Type | Selected source | Loading | Action |
| --- | --- | --- | --- | --- |
| Home/search/category/filter/suggestions | Listing card | thumbnail, display, original fallback | lazy | Keep UI; guarantee real variants |
| Assistant listing card | Listing card | thumbnail, display, original fallback | lazy | Keep UI; generate chat-upload variants server-side |
| Account listings and image manager | Listing thumbnail | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Favorites | Listing row | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Seller profile listings | Listing row | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Conversation listing preview | Listing thumbnail | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Admin listing rows | Admin thumbnail | thumbnail | lazy | Keep UI; backfill aliases |
| Moderation listing/report data | Review data | stored variants through listing mapper | lazy when rendered | Keep API mapping |
| Listing gallery strip | Gallery thumbnail | thumbnail | first eager, rest lazy | Keep dimensions |
| Gallery next-image preload | Detail image | display | one next image | Keep display-only preload |
| Lightbox | Full image | original, display fallback | mounted only when opened | Keep on-demand behavior |
| Uploaded listing preview | Local object/data URL | local normalized image | immediate user action | No server round trip |
| Uploaded profile picture | Avatar | 400px WebP when static | lazy on lists | Optimize separately from listings |
| OAuth profile picture | Avatar | provider URL | lazy where applicable | Keep external provider behavior |
| Brand logo | Static JPEG | local asset | small header image | Unchanged; already modest |
| Assistant bubble | Static decorative | 256px WebP | visible UI | Replaced 829,695-byte PNG with 8,116-byte WebP |
| Welcome wordmark | Static branding | WebP | first visit | Replaced 140,963-byte PNG with 14,878-byte WebP |
| Market surface | Decorative SVG | local SVG | CSS background | Unchanged; under 1KB and vector |
| PWA icons | Install assets | PNG required by manifest/platform | platform controlled | Unchanged |

The service worker ignores cross-origin R2/Cloudflare image requests. It does not
rewrite listing URLs. Existing original URLs remain valid and immutable.

## Native delivery reliability (2026-10-27)

The production image path remains API upload -> server validation and Sharp
variants -> Cloudflare R2 -> `images.souqhamad.com` -> native image cache. No
Cloudflare Images subscription, transformation URL, Worker, storage migration,
or changed image URL format is required by these fixes.

- Single-listing detail GET now reads current data and sends `no-store`, including
  404 responses. This prevents fresh responses from advertising removed objects
  or previously published listings. It trades the old 15-second JSON cache for a
  database read; image CDN caching and the search endpoint are unchanged. Old
  responses already held by an edge cache can remain until their existing TTL /
  stale window expires after deployment.
- A new listing image is attached only after original, display and thumbnail
  uploads all succeed. The three writes run concurrently. Transient network
  failures and HTTP 408/425/429/5xx receive at most three attempts with 200ms and
  500ms backoff, sharing the existing per-operation timeout budget. Permanent
  errors such as 403 are not retried. A terminal failure returns the existing 503
  upload response and releases idempotency so the customer can retry. It no
  longer creates a permanent original-sized alias for a failed small variant.
- A failed new UUID upload cleans up acknowledged successful siblings. Shared
  deterministic chat draft IDs are retained for a safe retry, since a concurrent
  operation may attach those same objects. Successful uploads and approved-image
  rules remain unchanged.
- R2 DELETE and Cloudflare purge use the same bounded transient retry policy.
  Purge requires both a successful HTTP response and `success: true`, and its
  deadline includes reading the response body. A failed sibling R2 deletion no
  longer prevents purging objects already removed. For compatibility,
  `deleteListingObject` returning `true` means R2 deletion completed; it does not
  promise that cache invalidation completed.

Runtime counters expose terminal outcomes: `image.storage.failed` (operation),
`image.delivery.incomplete`, `image.delivery.cleanup_incomplete`,
`image.cache_purge.completed`, and `image.cache_purge.incomplete` (reason:
`missing_config` or `provider_failure`). Structured purge warnings contain only
numeric provider codes / safe error names; they omit provider messages and
credentials. Runtime counters are per process and reset on restart, so production
log monitoring remains necessary.

Remaining operational limits:

- Retries are request-bound, not a durable background queue. A terminal outage,
  ambiguous provider acknowledgement, or interrupted process can leave objects
  or edge copies requiring an operator's review. No new queue infrastructure or
  database migration was added.
- Existing legacy alias records are preserved. Inspect them with
  `pnpm images:variants:dry-run` before any separately authorized repair; no
  production backfill is performed by the application update.
- Cloudflare purge requires the existing zone-scoped `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ZONE_ID`. Missing configuration is now observable; this update does
  not set credentials or change the Cloudflare account. Purge cannot remove an
  image already downloaded into a customer's local cache.
- The multipart request cap still relies on `Content-Length` before parsing,
  followed by a 12MB file check. A proxy body cap / bounded streaming parser is
  separate hardening and was not changed as part of the viewer reliability fix.

Regression coverage uses isolated marketplace fixtures and mocked providers:
fresh detail after deletion/pause, strict variants, transient recovery, cleanup,
same-key 503 -> 201 retry, shared chat IDs, partial deletion, purge rejection,
missing configuration and response-body timeout. It does not establish live
Cloudflare settings or Android/iPhone rendering performance.
