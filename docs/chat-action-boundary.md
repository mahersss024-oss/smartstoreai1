# Chat Action Boundary

Chat can search, compare listings, calculate price guidance, evaluate offers privately,
analyze images, and prepare an owned unpublished draft. Sensitive actions belong to
the user operating the marketplace interface, not to chat confirmation.

## Available Tools

- searchMarketplaceListings
- compareMarketplaceListings
- estimateListingPrice
- evaluateNegotiationOffer
- createListingDraft
- updateListing (owned draft only)
- addUploadedImagesToListing (owned draft only)
- analyzeListingImages

No chat tool publishes, pauses, deletes, marks sold, changes a primary image,
deletes images, changes favorites, submits reports, opens conversations, sends
messages, changes accounts or permissions, or executes payments. Private offer
evaluation does not accept, reject, send, or commit to a deal.

## Enforcement

The server exposes only the tools above. Draft input schemas strip unexpected
top-level IDs, owners, statuses, and options. Seller identity comes from the
authenticated session. Non-draft updates and image attachments are refused even
when model arguments contain confirmation flags.

Content updates include owner and draft status in the database write condition.
Image attachments recheck ownership and draft status inside the existing
serializable transaction. Unattached uploaded objects use existing cleanup.
The file-backed store checks draft status before its synchronous mutation.

Shared repository helpers default to existing behavior for client API callers;
chat explicitly enables draft-only guards. Client mutation routes and database
schema are unchanged. Prompts and capability descriptions match these limits.

## Verification

75 focused tests passed covering tool exposure, forged arguments, ownership,
all non-draft statuses, image storage, intent/scope handling, authentication,
publication, and the client route lifecycle. Database race guards were checked
with mocked Prisma delegates, not a live PostgreSQL concurrency test. The route
lifecycle uses the local file store, not production data. No live AI accuracy
or production-account test is implied by these checks.
