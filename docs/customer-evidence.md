# Customer dispute evidence

## Scope and compatibility

The database-backed marketplace keeps its existing routes, report actions and
customer editing flows. Report insertion atomically creates a separate evidence
case in PostgreSQL. This includes direct account reports, which may have no
listing or conversation. The file-backed development/fixture store keeps its
existing behavior; it is not a production evidence archive. The native wrapper
is unchanged.

Cases contain the listing, its current images, the reporting customer's related
conversation(s), all surviving messages at capture time, necessary participant
identity and associated commission records. Other buyers' conversations are
excluded. Deleted content that predates capture cannot be reconstructed.

Existing reports are backfilled from surviving data during the additive
migration. Their opening event is marked `legacy`; these snapshots must not be
represented as the original state at the historical report time.

## Deployment order

1. Take and validate a database backup. Test the migration against a staging copy.
2. Create a separate **private** R2 bucket. Disable public bucket URLs and public
   custom domains. Grant the server identity read/write/delete access to it.
3. Set `SMARTSTORE_EVIDENCE_STORAGE_BUCKET` to that bucket name. It must differ
   from `SMARTSTORE_OBJECT_STORAGE_BUCKET`. Existing endpoint, region and server
   credentials are reused. Never publish either storage credential to clients.
4. Run `pnpm db:deploy`, then deploy the application and generated Prisma client.
   Do not substitute `db:push`: SQL capture/guard triggers are part of the migration.
5. Create a synthetic report, verify every private asset reaches `stored`, test
   protected deletion, and inspect evidence through authenticated admin access.
6. Apply the approved retention/privacy policy to customer notices before launch.

No production database or cloud bucket is modified by local verification.
Once this migration is active, older app versions also encounter database guards;
do not remove the tables or triggers to roll back application code. Stage and
review rollback compatibility before production deployment.

## Durability and deletion

Snapshot and image-copy jobs are committed together with the report. A short,
transaction-scoped advisory lock per listing/user coordinates capture and relevant writes;
unrelated listings are not globally serialized. Network IO never runs while that lock is held. Assess contention under the site's
expected write workload in staging. Original snapshots are immutable. Subsequent
changes are append-only case events. DB guards cover direct/bulk/admin deletes,
not just buttons. Database owners can override database protections and must have
separately controlled access.

Image jobs run after the response, recover on opening evidence, and can be retried
by a moderator. Pending/failed jobs keep original image records and storage
objects protected. Each copy is read back and SHA-256 verified before being marked
stored. Untrusted arbitrary remote image URLs are not fetched; failure is explicit
and never represented as a complete archive. Monitor pending/failed cases and
the `[evidence]` logs, including after redeploys.

Deleting an account with protected evidence disables it rather than cascading
through its records, hides its listings, closes its conversations and removes
its web/native push registrations. Administrative permanent deletion of protected entities
returns 409. Listing edits and message deletion still operate, while case copies
and event history preserve evidence. Routine destructive maintenance remains
disabled in production.

Cases remain protected after closing. The default retention is 180 days after
closure; owner-level administrators may extend it or place/release an explicit
hold with a reason. Disposal requires a closed case, elapsed retention, complete
capture, no hold, no related open case or unpaid listing commission, a reason,
and the exact confirmation. Disposal is manual, never caused by account deletion.
Files are deleted first, then the snapshot, asset metadata and event payloads are
erased transactionally. Partial storage failure remains `disposing` and can be
resumed. A content-free disposal marker remains. Existing originals are not
implicitly erased by evidence disposal.

Backup expiry and disposal-marker reconciliation during restore are operational
requirements: application deletion cannot erase historic database/R2 backups.
Keep independent disposal records and reconcile restored data before serving it.

## Verification

`SMARTSTORE_DB_INTEGRATION=1 DATABASE_URL=<isolated-test-db> pnpm test tests/evidence-db-integration.test.ts`

Use a dedicated disposable database; integration fixtures deliberately clean up
their own synthetic cases. The migration requires PostgreSQL's SHA-256 function.
