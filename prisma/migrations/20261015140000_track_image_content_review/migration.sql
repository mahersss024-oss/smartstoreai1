-- Keep old image records unchanged; store review progress on new uploads only.
ALTER TABLE "ListingImage" ADD COLUMN "contentReviewStatus" TEXT;
