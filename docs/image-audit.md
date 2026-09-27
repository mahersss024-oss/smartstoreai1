# Image delivery audit

| Surface | Type | Selected source | Loading | Action |
| --- | --- | --- | --- | --- |
| Home/search/category/filter/suggestions | Listing card | thumbnail, display, original fallback | lazy | Keep UI; guarantee real variants |
| Assistant listing card | Listing card | thumbnail, display, original fallback | lazy | Keep UI; generate chat-upload variants server-side |
| Account listings and image manager | Listing thumbnail | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Favorites | Listing row | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Seller profile listings | Listing row | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Conversation listing preview | Listing thumbnail | thumbnail, display, original fallback | lazy | Keep UI; backfill aliases |
| Admin listing rows | Admin thumbnail | thumbnail | lazy | Keep UI; backfill aliases |
| Moderation listing/report data | Review data | stored variants through listing mapper | lazy when rendered | Keep API mapping |
| Listing gallery strip | Gallery thumbnail | thumbnail | first eager, rest lazy | Keep dimensions |
| Gallery next-image preload | Detail image | display | one next image | Keep display-only preload |
| Lightbox | Full image | original, display fallback | mounted only when opened | Keep on-demand behavior |
| Uploaded listing preview | Local object/data URL | local normalized image | immediate user action | No server round trip |
| Uploaded profile picture | Avatar | 400px WebP when static | lazy on lists | Optimize separately from listings |
| OAuth profile picture | Avatar | provider URL | lazy where applicable | Keep external provider behavior |
| Brand logo | Static JPEG | local asset | small header image | Unchanged; already modest |
| Assistant bubble | Static decorative | 256px WebP | visible UI | Replaced 829,695-byte PNG with 8,116-byte WebP |
| Welcome wordmark | Static branding | WebP | first visit | Replaced 140,963-byte PNG with 14,878-byte WebP |
| Market surface | Decorative SVG | local SVG | CSS background | Unchanged; under 1KB and vector |
| PWA icons | Install assets | PNG required by manifest/platform | platform controlled | Unchanged |

The service worker ignores cross-origin R2/Cloudflare image requests. It does not
rewrite listing URLs. Existing original URLs remain valid and immutable.
