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

- Use hosted object storage for listing images before public launch; local `public/uploads` is not durable on most hosting providers.
- Run `pnpm db:deploy` during deployment after setting `DATABASE_URL`.
- Set `SMARTSTORE_MARKETPLACE_STORE=database` in production.
- Keep `SMARTSTORE_ADMIN_EMAILS` restricted to trusted admin Google accounts.
