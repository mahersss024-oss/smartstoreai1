# Application activity measurement

The existing `POST /api/analytics/visit` accepts native foreground receipts with
`platform` (`ios` or `android`), a random persisted `visitorId`, and a `sessionId`.
No account or authentication is required. Bodyless requests and the website's
existing `path` body remain supported. The website uses its existing anonymous
cookie and excludes `/admin` navigation.

The application reads or creates its anonymous identifier asynchronously with
Expo SecureStore. This identifier is independent of account changes and logout;
it contains no email, phone number, advertising identifier or account ID. A
background failure has no visible loading state and never blocks navigation.
Requests time out after five seconds and retries retain the same session ID.
The foreground producer checks once a minute, sends at most once per five minutes
after success, and does not send while backgrounded. A new Saudi calendar day is
recorded during a long foreground session. Returning after at least thirty minutes
in the background rotates the session ID; short interruptions retain it.

An installation-scoped PostgreSQL advisory lock and a transaction update the two
existing analytics tables together. The first receipt per installation, platform
and Saudi day increments that day's unique count. Duplicate requests, heartbeats
and quick resumes do not increase native session counts. A new session requires a
different, previously unseen session ID and at least thirty minutes since the
last receipt. Each daily installation receipt keeps at most 128 session IDs,
including short resumes; after this cap, additional session counts fail closed
for that day. This bounds storage while keeping old retries idempotent. All
times and reporting dates are determined by the server.

The dashboard defaults to combined iOS/Android activity and offers separate
platform and website views. Today/seven-day/thirty-day active-device values count
distinct installation identifiers over the entire reporting window, rather than
adding daily unique totals. These are devices using the application, including
guests, and are not a count of people, downloads or currently connected sessions.
The registered-account activity card remains explicitly fourteen days. Selecting
a chart month does not change the rolling activity periods.

`20261107000000_app_usage_analytics` adds platform and receipt fields and indexes
to `SiteVisitDaily` and `SiteVisitUnique`; `20261107010000_app_session_receipts`
adds the bounded session receipt history. Neither migration creates a table.
Historical rows remain classified as website activity. Both migrations must be
applied before the updated server serves requests (the existing startup command
runs pending migrations). Coordinate the release because the old website visit
writer uses the previous unique key. Then build/distribute the updated native application to start
collecting its activity. Earlier app use cannot be reconstructed from the old
website counters. Changes and tests do not publish or deploy either application.

Focused checks cover receipt/session deduplication, stable identity, background
silence, failed requests, Saudi midnight, rolling distinct counts, and source
selection. The opt-in PostgreSQL test validates simultaneous duplicate requests
and rolling periods against the named disposable local database. Device/network
loss can still prevent a receipt from being recorded; these are observed activity
counts, not a census of installations.
