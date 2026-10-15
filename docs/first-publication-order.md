# Future Listing Publication Order

Only newly created application drafts opt into `firstPublicationTracked`.
Existing database rows and persisted file-store records stay on the legacy path,
including existing drafts. No historical publication dates are inferred or backfilled.

On successful seller publication or moderation approval, `firstPublishedAt` is
recorded once. Edits, favorites, pauses, sales and republication do not replace it.
Database publication uses a conditional write in the status-change transaction,
so concurrent requests cannot overwrite an already recorded timestamp.

The unfiltered marketplace feed lists tracked publications first, newest first.
Equal publication timestamps use a stable listing ID, not last update. Legacy
records follow using the existing last-update ordering. Search, filters, seller
lists and admin queues retain their previous ranking and routes.

## Deployment

Run `pnpm db:generate` when building and apply `pnpm db:deploy` before starting
the updated application. The existing production startup already deploys
migrations. The additive migration does not update historical listing content,
statuses, creation dates or update dates. Its partial index supports the feed's
ordering before pagination. Do not use `db push` in place of the migration.

Validate against an isolated PostgreSQL test database using
`SMARTSTORE_DB_INTEGRATION=1` and `pnpm test:db:integration`; never point tests at
the production database. The database integration suite is skipped without an
explicit opt-in and test database URL.
