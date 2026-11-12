# Realtime and image-delivery reliability

## Server event delivery

The SSE route recycles each request after 110 seconds, before App Runner's
120-second whole-request limit. SMARTSTORE_SSE_MAX_LIFETIME_MS can shorten this
to at least 15 seconds; larger values are clamped to 110 seconds. Heartbeats
remain 15 seconds and existing clients reconnect and reconcile authoritative
API reads.

Opening-rate limits remain in place. Each process additionally admits at most
256 streams and six streams per authenticated account or anonymous client IP.
SMARTSTORE_SSE_MAX_CONNECTIONS (1..4096) and
SMARTSTORE_SSE_MAX_CONNECTIONS_PER_CLIENT (1..32) tune these limits.
A full process/client returns 429 with Retry-After: 5. These are per-process
concurrency limits, not a distributed account quota.

Each stream queues at most 64 KiB downstream, 128 KiB of live pending frames and
one held frame. A live queue overflow closes the stream and releases its slot.
Replay is encoded incrementally when the reader pulls; a long retained history
does not itself fill the live queue or cause an endless reconnect cycle.
The local log retains at most 2,000 events and 4 MiB. Oversized hints
are omitted before retention/relay so one frame cannot poison later replay;
authoritative reconciliation still supplies the current record. Abort, cancellation, expiry,
authorization loss and overload dispose the subscription and release admission.
Current DB account/session/role authorization is checked before every output
batch and after a reader resumes.

When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are configured, replicas
also exchange events over a bounded Redis Stream using the existing REST API.
SMARTSTORE_REALTIME_BACKEND=memory explicitly disables the relay; unset uses
Redis when credentials are present. SMARTSTORE_REALTIME_REDIS_STREAM defaults
to smartstore:realtime:v1. Use distinct stream names for production and staging.
The credential needs EVAL/XADD/EXPIRE/XREAD permission. The shared log retains
at most 2,000 envelopes with one-hour idle expiry and preserves per-user/admin
visibility. Never expose its credentials or log private envelopes.

Subscribers poll the shared stream once per second, in bounded batches of 32;
no Redis polling runs without local subscribers. Local publication remains
immediate. The publisher queue is capped at 256 envelopes (16 KiB each) and
retries each envelope at most three times. Duplicate acknowledged/lost-response
entries are suppressed. Redis failures emit a rate-limited warning and leave
the existing API reconciliation safety net operating.

Numeric SSE IDs remain replica-local. Redis relay is a fan-out accelerator,
not a durable mutation outbox or a globally durable customer cursor. Browser
and native clients keep their existing reconnect and periodic API reconciliation.
No native app change is required for these server improvements.

## Bounded image DLQ recovery

The primary queue retains its existing 20 retries. The checked-in Worker config
now attaches a second consumer to souqhamad-image-uploads-dlq. Its first five
deliveries attempt the normal claim/processing flow; the existing database cap
of five processing attempts per job is never reset. Deliveries six through nine
only request terminal reconciliation through the existing protected claim URL:

POST /api/internal/image-uploads/{uploadId}/claim
Body: {"terminal":"delivery_exhausted"}

The Worker-only secret is required. The server refuses any live worker lease or
protected promotion, preserves ready/cancelled/failed/expired decisions, and
otherwise records failed/image_delivery_exhausted (or expired/cancelled when
current expiry/ownership rules require it). Only an explicit committed discard
response authorizes the Worker to clean the validated private source/stage keys.

DLQ max_retries is eight, with concurrency one. There is no queue cycle and no
infinite redrive. UPLOAD_DLQ_NAME must match the second consumer's queue name.
Persistent callback/DB outages can prevent immediate terminalization: the final
failure emits image_pipeline_recovery_exhausted and preserves private inputs.
The hourly server janitor eventually expires such jobs after their existing
24-hour lifetime and retries cleanup; it does not regenerate images.

Deploy the server callback support before applying the Worker configuration.
The config requires attaching the new DLQ consumer in the intended Cloudflare
account. Local tests do not prove that deployed consumer, Redis credentials,
queue backlog, R2 permissions or alerts exist. Inspect queue/consumer health and
exercise a controlled test-account upload before claiming live recovery works.

## Verification and references

Behavioral tests cover a 1,500-event ordered replay, slow-reader byte bounds,
admission release, request lifetime, replica relay visibility/deduplication,
finite retries and terminal reconciliation with live-lease/promotion/expiry
guards. Worker tests use mocked Cloudflare bindings and actual Sharp-generated
image bytes. They do not contact production.

- https://docs.aws.amazon.com/apprunner/latest/dg/develop.html
- https://upstash.com/docs/redis/features/restapi
- https://redis.io/docs/latest/commands/xread/
- https://redis.io/docs/latest/commands/xadd/
- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- https://developers.cloudflare.com/queues/configuration/batching-retries/
