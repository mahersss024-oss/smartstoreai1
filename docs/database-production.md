# SmartStore AI Database Production

SmartStore AI is standardized on PostgreSQL with Prisma.

## Recommended Providers

- Supabase: best when the project also needs hosted image storage and dashboard tools.
- Neon: best when the project needs lightweight hosted PostgreSQL with Vercel-friendly branching.

## Environment Variables

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

Keep this value server-side only.

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

## Runtime Store

The app supports two marketplace stores:

- `SMARTSTORE_MARKETPLACE_STORE=file`: local development fallback.
- `SMARTSTORE_MARKETPLACE_STORE=database`: production PostgreSQL through Prisma.

When the database store is enabled, listings, images, conversations, messages, favorites, reports, moderation queues, commissions, and admin commission actions run through Prisma. Keep the file store only as a development fallback.

## Production Notes

- Use hosted object storage for listing images before public launch; database `data:` image URLs are only a development fallback.
- Run `pnpm db:deploy` during deployment after setting `DATABASE_URL`.
- Set `SMARTSTORE_MARKETPLACE_STORE=database` in production.
- Keep `SMARTSTORE_ADMIN_EMAILS` restricted to trusted admin Google accounts.

## Listing Image Storage

For production, use hosted image storage. Cloudinary is the simplest no-card option for early launch:

```env
SMARTSTORE_IMAGE_STORAGE=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=smartstore/listings
```

Keep `CLOUDINARY_API_SECRET` server-side only in Render environment variables.

Alternatively, set these Render environment variables with an S3-compatible provider such as Cloudflare R2, AWS S3, or another compatible storage service:

```env
SMARTSTORE_IMAGE_STORAGE=object
SMARTSTORE_OBJECT_STORAGE_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
SMARTSTORE_OBJECT_STORAGE_BUCKET=smartstore-listings
SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID=...
SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY=...
SMARTSTORE_OBJECT_STORAGE_REGION=auto
SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL=https://PUBLIC_BUCKET_OR_CDN_DOMAIN
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
