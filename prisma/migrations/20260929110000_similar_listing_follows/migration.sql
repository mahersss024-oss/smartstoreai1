CREATE TABLE "SimilarListingFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "city" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimilarListingFollow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SimilarListingFollow_userId_listingId_key" ON "SimilarListingFollow"("userId", "listingId");
CREATE INDEX "SimilarListingFollow_userId_createdAt_idx" ON "SimilarListingFollow"("userId", "createdAt");
CREATE INDEX "SimilarListingFollow_category_city_createdAt_idx" ON "SimilarListingFollow"("category", "city", "createdAt");

ALTER TABLE "SimilarListingFollow" ADD CONSTRAINT "SimilarListingFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimilarListingFollow" ADD CONSTRAINT "SimilarListingFollow_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
