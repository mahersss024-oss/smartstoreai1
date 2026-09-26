-- Seller trust features: following and public seller ratings.
CREATE TABLE "SellerFollow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerFollow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerRating" (
    "id" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerFollow_followerId_sellerId_key" ON "SellerFollow"("followerId", "sellerId");
CREATE INDEX "SellerFollow_sellerId_createdAt_idx" ON "SellerFollow"("sellerId", "createdAt");

CREATE UNIQUE INDEX "SellerRating_raterId_sellerId_key" ON "SellerRating"("raterId", "sellerId");
CREATE INDEX "SellerRating_sellerId_createdAt_idx" ON "SellerRating"("sellerId", "createdAt");

ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerRating" ADD CONSTRAINT "SellerRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerRating" ADD CONSTRAINT "SellerRating_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH "rankedOpenDirectUserReports" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "reporterId", "targetUserId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "duplicateRank"
  FROM "UserReport"
  WHERE "status" = 'open' AND "conversationId" IS NULL
)
UPDATE "UserReport"
SET
  "status" = 'dismissed',
  "resolution" = 'dismiss',
  "resolvedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "rankedOpenDirectUserReports"
WHERE
  "UserReport"."id" = "rankedOpenDirectUserReports"."id"
  AND "rankedOpenDirectUserReports"."duplicateRank" > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "UserReport_unique_open_direct_user_report"
ON "UserReport"("reporterId", "targetUserId")
WHERE "status" = 'open' AND "conversationId" IS NULL;
