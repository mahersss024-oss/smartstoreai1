CREATE TYPE "ListingImageUploadStatus" AS ENUM ('pending', 'processing', 'ready', 'failed', 'cancelled', 'expired');
CREATE TABLE "ListingImageUpload" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "fileName" VARCHAR(200) NOT NULL,
  "mediaType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "sizeBytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "originalKey" TEXT NOT NULL,
  "displayKey" TEXT NOT NULL,
  "thumbnailKey" TEXT NOT NULL,
  "status" "ListingImageUploadStatus" NOT NULL DEFAULT 'pending',
  "errorCode" VARCHAR(80),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ListingImageUpload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ListingImageUpload_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 12582912),
  CONSTRAINT "ListingImageUpload_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListingImageUpload_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ListingImageUpload_sellerId_listingId_idempotencyKey_key" ON "ListingImageUpload"("sellerId", "listingId", "idempotencyKey");
CREATE INDEX "ListingImageUpload_listingId_status_expiresAt_idx" ON "ListingImageUpload"("listingId", "status", "expiresAt");
CREATE INDEX "ListingImageUpload_status_expiresAt_idx" ON "ListingImageUpload"("status", "expiresAt");
