# Native app and image delivery changes - 2026-10-28

## Model boundary

Hamad's chat flow, scope checks, image understanding and draft tools retain their
model behavior. The tools explicitly opt into repository assessment using an
internal option that is not taken from public request JSON. The manual category
suggestion endpoint remains model-assisted. Saving an accepted category, editing,
publishing, manual/direct image uploads, ordinary buyer/seller messages and
similarity no longer invoke or read model assessments. Historical assessments
and human moderation decisions are retained; technical validation, authentication,
ownership and conversation blocks remain authoritative.

Similarity is deterministic, with a conservative 85/100 threshold, shared category
and catalog branches, normalized title terms, precise brand/model checks and
rejection of conflicting product/part or wanted/sale attributes. It makes no
synonym/model request. A numeric score is a rule-based score, not a probability.

## Image pipeline

The device still normalizes selected sources to JPEG before upload. The JPEG is
private temporary intake, never the public image. It is deleted only after the
server durably acknowledges the processed result; lost acknowledgements and
retries preserve it until terminal cleanup. The existing lifecycle remains a
last-resort cleanup, not a replacement for successful per-job cleanup.

New negotiated jobs retain only processed WebP derivatives at 1800, 900 and 360px.
The persisted originalUrl field now points at the processed 1800px WebP; its name
remains for client compatibility. Existing JPEG URLs are not rewritten/deleted.
Claim requests advertise outputFormats; old Worker/new server and new Worker/old
server combinations continue to use legacy JPEG outputs. Output format is sticky
after the first claim and derived from the persisted originalKey, preventing a
retry from changing immutable destination keys. No image-job schema migration is
needed for this negotiation.

Manual direct uploads run at most two at once. Reservations are ordered by
selection; transfer and processing overlap. Server records use reservation time
for ordering and reconcile the earliest photo as primary. The editor settles all
started uploads, preserves successful results after another fails, refreshes the
owned listing, and leaves failed assets retryable. Legacy uploads remain serial.
Per-image status shows preparation, transfer, processing and completion.

The gallery mounts available thumbnails immediately, keeps previews visible while
full images load, accepts late success from the same attempt after a stall and
retries actual failures twice. It prioritizes the active image and prepares at
most eight previews with bounded concurrency. Older responses cannot replace a
new attempt. Gesture behavior and public URL compatibility are retained.

## Reads and notification delivery

Realtime invalidation targets event entities/query families and the current
account. Reconnect reconciliation remains; periodic reconciliation refreshes
stale active marketplace data rather than all queries. Listing detail requests a
seller summary using a separate query key; the full seller page still requests
its listing data. Public listing detail filters approved images server-side.

Database publication/message transactions enqueue NotificationDeliveryJob rows
before committing. Provider delivery happens after the response, with durable
leases, bounded retries, token cleanup, deduplication and source revalidation.
Fan-out creates bounded recipient batches. Source text and device credentials
are not stored in jobs. Failed provider results now reach retry handling instead
of being silently treated as success. Delivery is at least once: a provider
acceptance followed by a lost acknowledgement can still produce a duplicate;
existing notification tags group replacement notifications.

The server supervisor polls its own authenticated loopback notification endpoint
every 15 seconds using the existing Worker secret. The polling stops on shutdown
and never overlaps requests; database leases coordinate replicas. Bootstrap and
the existing hourly maintenance callback provide additional recovery triggers.
Without a supervisor secret, background recovery relies on those triggers. Exhausted jobs retain a failedAt marker for investigation.
Completed payloads are cleared and receipts expire after 30 days.

## Deployment order

1. Review and commit the server and nested mobile Git changes separately.
2. Deploy the server, applying the additive notification migration
   20261028100000_durable_notification_delivery first. App Runner's existing
   migrate-on-start configuration applies committed migrations on deployment.
3. Deploy the Cloudflare Worker from cloudflare/image-pipeline/wrangler.jsonc.
   Format negotiation supports either server/Worker order, but both must be
   deployed before new uploads use all-WebP delivery. Keep R2 event filters on
   intake/v1/ and JPEG suffix; source uploads remain JPEG.
4. Build the mobile application 1.0.46. Local native minimum is 198, above the
   confirmed store code 197. Codemagic adds PROJECT_BUILD_NUMBER to that floor.
5. On a device, check a multi-photo draft: stages, chosen primary, ordering,
   failed-item retry, gallery swipe/zoom, slow-network recovery and account change.
   Check FCM/APNs delivery and retry with dedicated accounts.

No production deployment, production migration, existing-image deletion or
store submission is part of the local implementation verification. Automated
fixtures do not establish live provider latency or visual device performance.

## Local verification

- Server source suite: 951 passed, 44 opt-in cases skipped, zero failed.
- Local PostgreSQL17 integration: all43 passed; this explicitly ran the image
  cancellation/lease/cleanup races and notification outbox transaction recovery.
- Mobile application: all245 tests passed.
- Cloudflare Worker: all34 mocked-boundary tests passed.
- Final supervisor/notification behavior subset: all8 passed.
- TypeScript and ESLint passed in both repositories.
- Optimized Next.js build passed, including the internal notification endpoint.
- Expo export passed for Android, iOS and web; native signing/device execution
  were not performed. Bundles are in .data/mobile-export-1.0.46/.

The database migration was applied only to the named disposable loopback test
instance. Automated results cover no production accounts or live image URLs.
