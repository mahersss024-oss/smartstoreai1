# Database Search and Human Review

## Search Contract

- The public website and the chat search tool use `listPublicMarketplaceListings`.
- Only published listing titles are searched. All literal query terms must match
  after Arabic spelling, digit and whitespace normalization. No synonym lists,
  model calls, description search or inferred categories run in this path.
- Explicit category, city, price, condition, year and mileage constraints are
  applied before pagination. The database determines result ordering.
- Chat interprets the customer's request and supplies product terms separately
  from explicit filters. A new search resets previous search state; refinement
  retains explicitly requested constraints.
- Comparison, price estimation and their calculations are separate services and
  have not been replaced by title search.

## Decision Authority

- Model concerns about listings, messages and images are advisory. They do not
  automatically reject, suspend or delete customer content.
- Concerns and assessment outages create review notifications through the
  existing `AdminAuditLog`. No new tables or migrations are required, and these
  notifications are not customer reports or evidence cases.
- Acknowledgement is shared across administrators. Reading a notification does
  not approve or reject the underlying content.
- The listing review queue includes published listings with unresolved listing
  or image assessments, as well as legacy pending listings. Human listing
  decisions close earlier assessments; later assessments can reopen review.
  Notification reads and conversation assessments do not resolve listing review.
- Authentication, ownership, blocked conversations, file validation and existing
  human moderation decisions remain enforced.
- Seller writes check the previously read status and compliance value, so a
  concurrent administrative decision cannot be overwritten by a stale write.
- Image review checks every supplied image without trusting earlier images as
  approval for later uploads. Technical upload limits remain unchanged.

## Chat Output Safety

- Regeneration is answer-only and exposes no tools. The original verified tool
  results are retained as untrusted reference data rather than instructions;
  rewriting cannot repeat draft writes or change search state.
- If output review is unavailable, the response is a static Arabic message, not
  unchecked generated output. This does not roll back an already completed draft
  operation from the initial attempt.
- Chat has no authority to publish, delete, open a conversation or send a
  marketplace message on behalf of the customer.

## Verification Boundaries

Focused tests cover literal matching, explicit filters, pagination, shared search
behavior, advisory assessments, administrative authority, concurrent seller
writes, shared notification acknowledgement and read-only regeneration tools.
Browser tests cover desktop/mobile search, manual category selection and review
notification presentation. A disposable PostgreSQL 17 cluster with the existing
migrations exercises title normalization, literal SQL parameters, explicit filters,
pagination, shared notification reads, human review outcomes, concurrent draft
replays and concurrent publication through the real Prisma repository. All 15
database integration tests passed on 2026-10-18. The server was bound to loopback
only and stopped after testing; production databases were not used.

No production database, live model accuracy, external image storage or AWS
deployment was verified by these checks. Database integration tests still require
a separate configured test database; a local PostgreSQL run does not verify RDS
configuration, production data or cloud network access.
