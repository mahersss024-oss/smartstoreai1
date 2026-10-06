# Souq Hamad Load Testing Architecture

## Current Project Map

- Framework: Next.js 16 App Router.
- Rendering: dynamic App Router pages and route handlers.
- Database: Prisma with PostgreSQL through `DATABASE_URL`.
- Auth/session: signed session cookie helpers in `lib/auth/session.ts`.
- Public listings: `/api/marketplace/listings` with short public JSON cache.
- Listing detail: `/api/marketplace/listings/[listingId]` with short public JSON cache.
- Images: listing image URLs are stored on each listing image record and may point
  to object storage/CDN public URLs.
- Object storage: S3-compatible storage in `agent/marketplace/object-storage.ts`.
- CDN: public object URL can be Cloudflare/R2 custom domain such as
  `images.souqhamad.com`.
- Realtime: SSE route at `/api/realtime/stream`, with client fallback polling.
- Pagination/infinite scroll: pages use `useInfiniteScroll` and paginated APIs.
- Rate limits: shared API rate limiter in `lib/api/rate-limit.ts`.
- Push notifications: web push subscription and notification APIs.

## Request Flow

User
-> Browser or installed app
-> Next.js page navigation
-> Client fetch or route handler
-> Auth/session validation when needed
-> Marketplace repository/service logic
-> Prisma/PostgreSQL
-> Object storage URLs for images
-> Cloudflare/CDN image delivery
-> JSON/HTML response
-> UI render and image decode/display

## Main Page Flow Dependencies

| Page | APIs | DB | Images | Realtime |
| --- | --- | --- | --- | --- |
| `/` | `/api/marketplace/listings`, `/api/chat`, `/api/analytics/visit` | listings/search state | listing thumbnails, logo | no direct SSE |
| `/listings/[listingId]` | detail, favorite, reports, follow, conversations | listing, seller, reports, favorites | gallery/display images | optional after actions |
| `/account` | session, profile, logout, profile picture | user profile | avatar/logo | no |
| `/account/listings` | my listings, listing mutations, image upload/delete | listings/images | thumbnails | SSE optional |
| `/favorites` | favorites, favorite mutations | favorites/listings | thumbnails | SSE |
| `/conversations` | conversation list, delete | conversations/messages | listing thumbs | SSE |
| `/conversations/[conversationId]` | conversation detail/send/read/report/block | conversations/messages | listing thumbs | SSE |
| `/notifications` | notifications, push subscribe | notifications/subscriptions | logo | no |
| `/admin/*` | admin APIs by role | users/listings/reports/audit | listing thumbs | SSE on action pages |

## Load Stages

The staged tests are intentionally guarded. Run read-only production tests only
after enabling `ALLOW_PRODUCTION_LOAD_TEST=true`; run write tests only on staging.

Suggested escalation:

| Stage | Users | Purpose |
| --- | ---: | --- |
| 1 | 50 | baseline |
| 2 | 100 | light production-like read mix |
| 3 | 250 | growing public traffic |
| 4 | 500 | sustained read capacity |
| 5 | 1000 | stress on staging |
| 6 | 2500 | staging only |
| 7 | 5000 | staging only |
| 8 | 10000 | staging only with infra monitoring |

Do not report capacity numbers unless they come from measured staging results.
