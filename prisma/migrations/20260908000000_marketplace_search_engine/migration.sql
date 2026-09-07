-- Add searchable listing text so attributes confirmed through chat remain searchable.
ALTER TABLE "Listing" ADD COLUMN "searchText" TEXT;

UPDATE "Listing"
SET "searchText" = lower(
  concat_ws(
    ' ',
    "category",
    "title",
    "description",
    "city",
    "condition"::text,
    "attributes"::text
  )
)
WHERE "searchText" IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Listing_searchText_trgm_idx" ON "Listing" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX "Listing_searchText_fts_idx" ON "Listing" USING GIN (to_tsvector('simple', coalesce("searchText", '')));

-- Store server-side buyer search state. The UI remains a view, not the source of truth.
CREATE TABLE "MarketplaceSearchState" (
  "id" TEXT NOT NULL,
  "ownerKey" TEXT NOT NULL,
  "state" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceSearchState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceSearchState_ownerKey_key" ON "MarketplaceSearchState"("ownerKey");
CREATE INDEX "MarketplaceSearchState_updatedAt_idx" ON "MarketplaceSearchState"("updatedAt");

CREATE TABLE "ApiIdempotencyKey" (
  "id" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "actorKey" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "statusCode" INTEGER,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApiIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiIdempotencyKey_namespace_actorKey_key_key" ON "ApiIdempotencyKey"("namespace", "actorKey", "key");
CREATE INDEX "ApiIdempotencyKey_createdAt_idx" ON "ApiIdempotencyKey"("createdAt");
