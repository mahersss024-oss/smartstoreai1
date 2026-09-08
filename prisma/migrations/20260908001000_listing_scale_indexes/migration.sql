-- Improve public listing browsing and card image lookup as catalog size grows.
CREATE INDEX IF NOT EXISTS "Listing_status_category_city_updatedAt_idx"
ON "Listing"("status", "category", "city", "updatedAt");

CREATE INDEX IF NOT EXISTS "ListingImage_listingId_status_isPrimary_idx"
ON "ListingImage"("listingId", "status", "isPrimary");
