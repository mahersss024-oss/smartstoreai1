# SmartStore AI

SmartStore AI is a chat-first Saudi smart marketplace inspired by classifieds apps. It helps buyers search listings and helps sellers create and manage listings through conversation, with internal buyer-seller chat, moderation, image checks, favorites, reports, and 1% commission tracking for site-completed sales.

## Setup

- Node.js: 24.x to 26.x (24.x recommended for deployment parity)
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
- Buyers search SmartStore AI marketplace listings only; the app does not invent listings, sellers, prices, images, or availability.
- Google or Apple sign-in is required for account-bound actions such as publishing, editing, messaging, favorites, reports, and seller controls.
- Before sign-in, users must acknowledge a 1% commission on the product value when a sale is completed through the site.
- Marking a listing as sold creates a 1% commission record; sellers can review commissions and admins can manage payment status.
- Buyers and sellers communicate through internal SmartStore AI conversations.
- Admin emails configured in `SMARTSTORE_ADMIN_EMAILS` can access `/admin/moderation` to review sensitive listings and reports.
- Apple sign-in requires `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.
- Products prohibited in Saudi Arabia or conflicting with Islamic values are blocked or routed to review.
- Images are uploaded through chat or listing tools and checked for quality, sensitive information, policy compliance, and category mismatch.
- Production database is standardized on PostgreSQL through Prisma; see `prisma/schema.prisma`.

## Documents

- [docs/smart-marketplace-foundation.md](docs/smart-marketplace-foundation.md)
- [docs/database-production.md](docs/database-production.md)
- [docs/production-readiness-gaps.md](docs/production-readiness-gaps.md)
