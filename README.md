# SmartStore AI

Chat-first Saudi smart marketplace for allowed non-food classifieds, seller listing creation, buyer search, internal conversations, and AI-assisted trust checks.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Notes

- Connected product data is used only when the server-side Product Data API is configured.
- The assistant now acts as a side-panel marketplace assistant, not only a full-page shopping chatbot.
- Listing creation is conversational: the seller talks, the AI infers category and missing details, then shows a preview.
- Google sign-in is required for account-bound actions such as publishing, editing, messaging, favorites, and reports.
- Before Google sign-in, users must acknowledge a 1% commission on the product value when a sale is completed through the site.
- Marking a listing as sold creates a 1% commission record; sellers can review commissions and admins can manage payment status.
- Buyers and sellers have internal conversation pages, plus account and favorites pages for saved listings and seller controls.
- Admin emails configured in `SMARTSTORE_ADMIN_EMAILS` can access `/admin/moderation` to review sensitive listings and reports.
- Products prohibited in Saudi Arabia or conflicting with Islamic values are blocked or routed to review.
- Production database is standardized on PostgreSQL through Prisma; see `prisma/schema.prisma`.
- Images are uploaded through chat and must be checked for quality, sensitive information, and truth-preserving enhancement.
- Country, currency, and language settings are available in the app for better recommendations.
- Web search is available for current facts, documentation, and company details.
- AI model profiles are configurable with `DEEPSEEK_MODEL`, `DEEPSEEK_CHAT_MODEL`, `DEEPSEEK_SCOPE_MODEL`, `DEEPSEEK_MODERATION_MODEL`, and `DEEPSEEK_VISION_MODEL`.
- Product data fetching should be provided by a separate server-side Product Data API.
- Food, groceries, beverages, meals, and restaurant orders are outside the assistant scope.

## Product Data API Foundation

SmartStore AI is designed to connect later to a separate product data service through a private server-side API key.

Architecture:

```text
Client -> Scope Guard -> Product Data API -> Shopping Assistant -> Output Guard -> Client
```

The chat app must not invent product prices, availability, images, or purchase links. Those fields should come from a real Product API, product feed, affiliate API, or merchant integration. Food and grocery products are excluded.

See the technical foundation document:

[docs/product-data-api-foundation.md](docs/product-data-api-foundation.md)

See the smart marketplace foundation document:

[docs/smart-marketplace-foundation.md](docs/smart-marketplace-foundation.md)

See the production database document:

[docs/database-production.md](docs/database-production.md)
