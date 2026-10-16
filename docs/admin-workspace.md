# Admin Workspace

The administration shell adapts TailAdmin's sidebar/header and chart composition
to the existing marketplace theme, RTL layout and role checks. Attribution is in
`docs/licenses/tailadmin.txt`. The standalone template remains separate. Its demo
authentication, routing, providers and sample data are not part of the app.

## Compatibility

- All existing `/admin` pages and mutation endpoints remain in place.
- Existing page-level access checks and server authorization remain authoritative.
- Moderators retain listing/report access; the new financial and workspace
  overview is restricted to the existing admin/owner roles.
- The default response of `GET /api/admin/overview` is unchanged.
- `GET /api/admin/overview?view=workspace&month=YYYY-MM` adds a read-only view
  using existing tables. It is protected by the same verified admin check.
- No Prisma schema changes, migrations, additional tables, background jobs,
  production data changes or remote deployment are required by this change.

## Data Semantics

Daily visit charts use `SiteVisitDaily`; unique visitors are unique per day,
not unique across the month. Missing days are not invented or interpolated.
Listing, commission and evidence totals describe current retained records,
not historical snapshots. Decimal commission amounts are serialized as strings.

The selected month applies to visit charts and calendar dates, not current
status totals. Month boundaries and displayed dates use Asia/Riyadh.

The read-only calendar displays evidence-retention review dates and expiration
of the current enabled site message. It returns at most 100 evidence dates per
month and explicitly indicates additional records. A review date never overrides
legal holds, evidence-retention checks, or disposal permissions. Calendar links
open the existing management sections without performing an action.

The follow-up summary derives counts from current records when the overview is
loaded or refreshed. It does not send email/push, acknowledge notifications,
create tasks, schedule reminders, or persist anything in browser storage.

## Verification

Unit tests: `tests/admin-workspace.test.ts` covers date boundaries, bounded
queries, empty states, read-only integration and authorization. Existing
overview, admin, moderation and route-access tests remain applicable.

Browser tests: `e2e/admin-workspace.spec.ts` uses mocked API responses and signed
test sessions, with 360/768/1024/1440 widths, charts, calendar, scrolling,
drawer keyboard behavior, shared theme, moderator visibility and retry states.
`e2e/customer-evidence.spec.ts` checks the existing evidence workflow within
the new shell. These do not constitute live production database verification.
