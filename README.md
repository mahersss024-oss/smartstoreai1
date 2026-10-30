# سوق حمد

The public `/` page is an Android/iPhone app gateway. It shows a mobile app-open
action and a desktop QR for `https://souqhamad.com/`; it does not restore the
retired web marketplace. Administration remains at `/admin` and the native app
continues to use the server APIs independently.

Customer listing, seller, favorites, conversations, fees and notification URLs
now show the app gateway, retaining resource IDs in app handoffs and QR links.
Verified staff retain read-only listing/seller previews at the same URLs.
`/admin` has an explicit administrative sign-in entry and logout returns there;
it does not depend on customer navigation or the download page. The existing
Google authentication, agreement, session and server-side role checks remain.

Native listing details request up to 20 similar cards through the existing
`GET /api/marketplace/listings/[listingId]?view=similar` view. The shared
deterministic matcher ranks structured category/identity matches above title
matches; no similarity model or new API path is introduced. Applying the native
UI requires rebuilding the mobile app as well as deploying the server.

Leave `NEXT_PUBLIC_ANDROID_APP_STORE_URL` and `NEXT_PUBLIC_IOS_APP_STORE_URL`
empty until official destinations exist. Android accepts HTTPS Google Play
details links for `com.souqhamad.app`; iPhone accepts HTTPS App Store app listings
or TestFlight join links. Missing or invalid values show “قريبًا” without invented
download links. Configuring a link validates its form, not whether the store has
published it. Public build variables should be set before building/deploying.

سوق حمد is a chat-first Saudi smart marketplace inspired by classifieds apps. It helps buyers search listings and helps sellers create and manage listings through conversation, with internal buyer-seller chat, moderation, image checks, favorites, reports, and 1% commission tracking for site-completed sales.

## Setup

- Node.js: 22.x to 24.x (22.x recommended for deployment parity)
- pnpm: 10.32.1+
- Production: set `SMARTSTORE_MARKETPLACE_STORE=database`

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Marketplace Scope

- The assistant understands customer intent from natural chat and routes each request to the right marketplace operation.
- Listing creation is conversational: the seller talks, the AI infers category and missing details, then shows a preview before publishing.
- Buyers search سوق حمد marketplace listings only; the app does not invent listings, sellers, prices, images, or availability.
- Google or Apple sign-in is required for account-bound actions such as publishing, editing, messaging, favorites, reports, and seller controls.
- Before sign-in, users must acknowledge a 1% commission on the product value when a sale is completed through the site.
- Marking a listing as sold creates a 1% commission record; sellers can review commissions and admins can manage payment status.
- Buyers and sellers communicate through internal سوق حمد conversations.
- Admin emails configured in `SMARTSTORE_ADMIN_EMAILS` can access `/admin/moderation` to review sensitive listings and reports.
- Apple sign-in requires `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.
- Products prohibited in Saudi Arabia or conflicting with Islamic values are blocked or routed to review.
- Images are uploaded through chat or listing tools and checked for quality, sensitive information, policy compliance, and category mismatch.
- Production database is standardized on PostgreSQL through Prisma; see `prisma/schema.prisma`.

## Documents

- [docs/smart-marketplace-foundation.md](docs/smart-marketplace-foundation.md)
- [docs/database-production.md](docs/database-production.md)
