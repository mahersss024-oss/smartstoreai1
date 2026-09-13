# SmartStore AI Database Production

SmartStore AI is standardized on PostgreSQL with Prisma.

## Recommended Providers

- Supabase: best when the project also needs hosted image storage and dashboard tools.
- Neon: best when the project needs lightweight hosted PostgreSQL with Vercel-friendly branching.

## Environment Variables

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
SMARTSTORE_MAX_LISTINGS_PER_SELLER=100
SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS=100
SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS=2000
SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS=60000
```

Keep this value server-side only.
`SMARTSTORE_MAX_LISTINGS_PER_SELLER` controls saved non-deleted listings per
seller account. It defaults to `100` when unset. Any positive integer configured
in Render is used as the active limit; this does not limit the total platform
listings across all sellers. Keep this variable managed in the Render dashboard
so production can raise or lower the limit without a code change.

The DeepSeek concurrency defaults above were validated with real staged load
tests up to 500 concurrent chat users. `SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS`
caps active provider calls, `SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS` prevents
unbounded in-memory queue growth, and `SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS`
keeps overloaded requests from hanging indefinitely.

## Local And Production Commands

```bash
docker compose up -d postgres
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:push
pnpm db:studio
```

Use `pnpm db:migrate` for development migrations and `pnpm db:deploy` in production deployment pipelines. Use `pnpm db:push` for quick local schema syncing when you do not need a migration file yet.

## Core Tables

The Prisma schema includes:

- `User`
- `Listing`
- `ListingImage`
- `Conversation`
- `ConversationMessage`
- `Favorite`
- `Report`
- `Commission`
- `AdminAuditLog`
- `PushSubscription`

## Runtime Store

The app supports two marketplace stores:

- `SMARTSTORE_MARKETPLACE_STORE=file`: local development fallback.
- `SMARTSTORE_MARKETPLACE_STORE=database`: production PostgreSQL through Prisma.

When the database store is enabled, listings, images, conversations, messages, favorites, reports, moderation queues, commissions, and admin commission actions run through Prisma. Keep the file store only as a development fallback.

## Production Notes

- Use hosted object storage for listing images before public launch; database `data:` image URLs are only a development fallback.
- Run `pnpm db:deploy` during deployment after setting `DATABASE_URL`.
- Set `SMARTSTORE_MARKETPLACE_STORE=database` in production.
- Keep `SMARTSTORE_ADMIN_EMAILS` restricted to trusted admin account emails.
- Keep `SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP=0` in production unless a
  planned admin maintenance window explicitly requires destructive cleanup.
- Configure `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
  `APPLE_PRIVATE_KEY` before submitting an iOS app that also offers Google
  sign-in.

## Listing Image Storage

For production, use hosted image storage. Cloudinary is the simplest no-card option for early launch:

```env
SMARTSTORE_IMAGE_STORAGE=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=smartstore/listings
SMARTSTORE_MAX_IMAGES_PER_LISTING=8
```

Keep `CLOUDINARY_API_SECRET` server-side only in Render environment variables.
`SMARTSTORE_MAX_IMAGES_PER_LISTING` defaults to `8` when unset. Production can
lower this value, but the application caps it at `8` to protect storage,
bandwidth, and listing page work.

## Manual Commission Payment Methods

The seller commissions page can show manual payment instructions for Al Rajhi,
SNB, and STC Pay. Add only the methods you want to display; any empty method is
hidden automatically.

```env
SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NAME=SmartStore AI
SMARTSTORE_COMMISSION_ALRAJHI_ACCOUNT_NUMBER=...
SMARTSTORE_COMMISSION_ALRAJHI_IBAN=SA...

SMARTSTORE_COMMISSION_SNB_ACCOUNT_NAME=SmartStore AI
SMARTSTORE_COMMISSION_SNB_ACCOUNT_NUMBER=...
SMARTSTORE_COMMISSION_SNB_IBAN=SA...

SMARTSTORE_COMMISSION_STC_PAY_NAME=SmartStore AI
SMARTSTORE_COMMISSION_STC_PAY_ACCOUNT=...
```

`SMARTSTORE_COMMISSION_STC_PAY_ACCOUNT` holds the STC Pay account number and is
shown to sellers as "رقم الحساب". `SMARTSTORE_COMMISSION_STC_PAY_NUMBER` is
accepted as a legacy alias when `..._ACCOUNT` is not set. Set only one of them
in production; the account key takes priority when both are present.

Keep these values managed in the Render dashboard so payment recipients can be
changed without a code deployment.

Alternatively, set these Render environment variables with an S3-compatible provider such as Cloudflare R2, AWS S3, or another compatible storage service:

```env
SMARTSTORE_IMAGE_STORAGE=object
SMARTSTORE_OBJECT_STORAGE_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
SMARTSTORE_OBJECT_STORAGE_BUCKET=smartstore-listings
SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID=...
SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY=...
SMARTSTORE_OBJECT_STORAGE_REGION=auto
SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL=https://PUBLIC_BUCKET_OR_CDN_DOMAIN
SMARTSTORE_MAX_IMAGES_PER_LISTING=8
```

`SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL` must be a public bucket URL or CDN URL that can serve uploaded listing images in the browser. If `SMARTSTORE_IMAGE_STORAGE` is empty, the app keeps the local development fallback.

## Shared Chat Rate Limiting

For multi-instance production deployments, add Upstash Redis REST credentials:

```env
SMARTSTORE_RATE_LIMIT_BACKEND=redis
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Without Redis credentials, the app still rate-limits chat requests in memory, which is acceptable for local development and single-instance testing.
