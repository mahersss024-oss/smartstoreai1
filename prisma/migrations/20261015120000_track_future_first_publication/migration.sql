-- Existing listings remain untracked; only new application drafts opt in.
ALTER TABLE "Listing"
  ADD COLUMN "firstPublicationTracked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "firstPublishedAt" TIMESTAMP(3);

CREATE INDEX "Listing_publication_feed_idx" ON "Listing" (
  "firstPublishedAt" DESC NULLS LAST,
  (CASE WHEN "firstPublishedAt" IS NULL THEN "updatedAt" END) DESC,
  "id" DESC
) WHERE "status" = 'published';
