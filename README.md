# SmartStore AI

AI shopping assistant for product guidance, comparison, and decision support.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## Notes

- Live product fetching is disabled.
- The assistant focuses on comparisons, criteria, and general shopping advice.
- Region settings are available in the app for better recommendations.
- Web search is available for current facts, documentation, and company details.
- Product data fetching should be provided by a separate server-side Product Data API.

## Product Data API Foundation

SmartStore AI is designed to connect later to a separate product data service through a private server-side API key.

Architecture:

```text
Client -> Scope Guard -> Product Data API -> Shopping Assistant -> Output Guard -> Client
```

The chat app must not invent product prices, availability, images, or purchase links. Those fields should come from a real Product API, product feed, affiliate API, or merchant integration.

See the technical foundation document:

[docs/product-data-api-foundation.md](docs/product-data-api-foundation.md)
