# SmartStore AI

AI shopping assistant for non-food product guidance, comparison, and decision support.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Notes

- Connected product data is used only when the server-side Product Data API is configured.
- The assistant focuses on non-food product comparisons, criteria, and general shopping advice.
- Country, currency, and language settings are available in the app for better recommendations.
- Web search is available for current facts, documentation, and company details.
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
