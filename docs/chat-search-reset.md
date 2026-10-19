# Independent Chat Searches

> Historical implementation notes. Hamad no longer searches for products or
> changes search state. See [the current role contract](hamad-role.md).

New searches replace the stored search constraints by default, including when
the user requests the same product again. Previously, an omitted search mode
implicitly merged old city, price, year, mileage, condition, color, descriptive
terms and preference constraints. That could incorrectly hide existing ads.

Only an explicit `searchMode: refine` continues a current search. A changed
category, brand or model still starts fresh. A refinement can add descriptive
terms without being mistaken for a product change. No prior state means the
operation starts as `new_search` even if refinement was requested.

The chat search tool's result note now describes replacement by default rather
than unconditional accumulation. The model remains responsible for identifying
intentional follow-up refinements. This change does not clear chat messages,
delete listings, modify pricing calculations or disable search persistence.

First-party chat now scopes the stored constraints by authenticated account and
conversation ID. Each tab/device has a separate ID; in-app navigation restores
the same one. Starting a new chat rotates it and sends the previous ID to the
existing reset endpoint. Resetting one conversation cannot clear another's
search filters. Realtime search events preserve user-only visibility and the
home page ignores events for another conversation. Requests with malformed IDs
or a stale account owner are rejected. Legacy callers omitting the ID keep their
original namespace. The existing incomplete-draft cleanup remains unchanged;
this isolation concerns search state, not a new draft lifecycle or database table.

Focused verification on 2026-10-18: 38 search, understanding, tool and display
tests passed. The regression test first reproduced missing listings with the
old implementation, then verified their return after an independent same-item
search. Database-path verification uses a simulated Prisma delegate, not a live
production database. TypeScript and targeted lint passed. No full suite or
live-model conversation was run for this focused fix. Changes are local and
have not been pushed.
