-- Rejected listings remain editable by their owner. Image readiness does not
-- grant publication or override a human moderation decision.
CREATE OR REPLACE FUNCTION smartstore_cancel_listing_uploads() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'listing_deleted',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "listingId" = OLD."id";
    RETURN OLD;
  END IF;
  IF NEW."status" = 'deleted' THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'image_upload_target_changed',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "listingId" = NEW."id" AND "status" IN ('pending', 'processing');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
