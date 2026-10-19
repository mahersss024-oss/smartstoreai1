# Listing identifiers

New listings from manual creation and assistant draft creation use the same
`createListingId` factory: a `c` prefix followed by 24 lowercase alphanumeric
characters. The identifier remains an opaque string, not a sequence or a public
listing count. No database schema change or data migration is required.

Manual creations receive a random identifier. Assistant creations derive a stable
identifier from the seller and operation key, so retries do not create another
draft. Existing `chat-draft-...` operations are checked for replay only; this
format is never generated for a new listing. Existing records and URLs are not
renamed or rewritten.

Public marketplace search recognizes complete identifiers, listing URLs and
explicitly labeled identifiers. It applies exact ID equality in both storage
backends, preserving publication visibility, explicit filters and pagination.
Other queries continue to search titles without consulting a model. Partial IDs
and visual truncation markers are not accepted as references.

Listing details show the complete identifier with wrapping on small screens.
The copy action copies the same identifier used in the listing URL and search.

Focused verification: `tests/listing-id.test.ts`,
`tests/listing-id-search.test.ts`, and `e2e/listing-reference.spec.ts`.
