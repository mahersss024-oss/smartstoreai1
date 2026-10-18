# Customer Language

Customer interface copy and assistant replies are Arabic-only. Legacy `en`
preferences are still accepted for compatibility, but resolve to Arabic copy
and RTL presentation. A chat request cannot switch the reply language through
its region settings. Internal model schemas, protocol keys, identifiers and
URLs retain their technical representation.

The main agent and issue-response generator are instructed to reply in Arabic,
including when input is in another language. Before emitting visible text, the
server rejects non-Arabic prose and uses the existing regeneration path or an
Arabic fallback. The client also guards assistant text, including restored
history, without rewriting the saved messages. Link destinations and the
authentication marker remain functional; link labels must be Arabic.

Interface labels, accessible controls and default attachment labels are Arabic.
API error codes are not used as customer messages when Arabic guidance is
unavailable. Speech recognition uses the Saudi Arabic locale.

Customer-authored messages, account names, filenames, seller listing titles and
descriptions are not translated or rewritten. This change governs system-owned
copy and generated replies, not customer data or third-party sign-in pages.
No table or migration is required. No live-model accuracy claim is implied.

Verification on 2026-10-18: 36 focused tests, TypeScript, targeted ESLint and
the production build passed. Four Chromium browser cases passed across desktop
and mobile, including Arabic replies despite an English preference and hiding
foreign assistant output without changing customer input. Screenshots were
inspected. Browser output was simulated; no paid live-model evaluation or
production database operation was performed.
