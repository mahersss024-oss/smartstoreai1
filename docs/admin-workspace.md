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

## Page Presentation

The overview no longer repeats the sidebar navigation or logo header. Existing
administrative pages use a shared heading and consistent record/filter layouts.
Evidence, conversations and audit metadata have readable field labels and event
titles; original identifiers, payloads and hashes remain in collapsed technical
details. No evidence is discarded or rewritten by presentation components.

Presentation checks are deliberately scoped: `tests/admin-record-details.test.ts`
and `e2e/admin-page-presentation.spec.ts`, plus the existing evidence browser
checks and selected administrative source-contract tests. No full test suite or
live production database test is needed to inspect the display-only changes.

## Interactive Records And Notifications

Listings and users now use compact desktop tables and mobile record lists. The
existing edit forms and mutation handlers render inside a shared accessible
preview. Previous/next navigation uses the loaded result set, and closing or
switching a dirty record requires confirmation. Drafts remain in page state;
they are not shared or persisted between sessions. Destructive confirmations
and protected-owner conditions remain unchanged.

The existing listing GET route accepts an optional exact `sellerId` filter.
The existing moderation GET route accepts optional `reportId`/`sourceType`
filters for direct report navigation. Default pagination and queries remain.

The header report inbox reads existing open listing/conversation reports joined
to their evidence cases. `GET /api/admin/moderation?view=notifications` is bounded
and staff-authorized. `PATCH /api/admin/moderation` with `notification_viewed`
records the first viewer in the existing `EvidenceEvent` ledger under an
advisory transaction lock. It never changes report resolution, evidence snapshots,
retention, or disposal state. Other staff share that acknowledgement. In-process
realtime invalidation and a visible-tab 30-second refresh reconcile the inbox
across instances; opening the menu also refreshes it. A failed acknowledgement
keeps the item available for retry. File-mode previews explicitly cannot persist
these notifications and display an error, not fabricated inbox data.

No new tables, migrations, dependencies or administrative URL paths are added.
Administrative tasks/reminders are not implemented. Status distributions use
existing grouped counts; visit chart modes use only recorded daily rows. Loaded
user/contact counts are not presented as platform-wide totals.

Focused verification additionally covers `tests/admin-report-notifications.test.ts`
and the preview/inbox/browser cases in `e2e/admin-page-presentation.spec.ts`.
Browser fixtures and injected database doubles are isolated from production;
they do not verify a live PostgreSQL connection or deployment.
