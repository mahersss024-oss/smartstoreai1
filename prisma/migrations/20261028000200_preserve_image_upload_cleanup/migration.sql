-- Upload manifests outlive the resource they belong to so abandoned private and
-- partially copied public objects remain discoverable after account cascades.
ALTER TABLE "ListingImageUpload" DROP CONSTRAINT "ListingImageUpload_listingId_fkey";
ALTER TABLE "ListingImageUpload" DROP CONSTRAINT "ListingImageUpload_sellerId_fkey";
ALTER TABLE "ListingImageUpload" ADD COLUMN "cleanupAt" TIMESTAMP(3);
CREATE INDEX "ListingImageUpload_status_cleanupAt_idx" ON "ListingImageUpload"("status", "cleanupAt");

CREATE FUNCTION smartstore_cancel_listing_uploads() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'listing_deleted',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "listingId" = OLD."id";
    RETURN OLD;
  END IF;
  IF NEW."status" IN ('deleted', 'rejected') OR NEW."compliance"->>'humanDecision' = 'block' THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'image_upload_target_changed',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "listingId" = NEW."id" AND "status" IN ('pending', 'processing');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER smartstore_cancel_listing_uploads_on_delete BEFORE DELETE ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION smartstore_cancel_listing_uploads();
CREATE TRIGGER smartstore_cancel_listing_uploads_on_moderation BEFORE UPDATE OF "status", "compliance" ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION smartstore_cancel_listing_uploads();

CREATE FUNCTION smartstore_cancel_user_uploads() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'account_deleted',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerId" = OLD."id";
    RETURN OLD;
  END IF;
  IF NEW."deletedAt" IS NOT NULL THEN
    UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'account_deactivated',
      "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "sellerId" = NEW."id" AND "status" IN ('pending', 'processing');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER smartstore_cancel_user_uploads_on_delete BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION smartstore_cancel_user_uploads();
CREATE TRIGGER smartstore_cancel_user_uploads_on_deactivation BEFORE UPDATE OF "deletedAt" ON "User"
  FOR EACH ROW EXECUTE FUNCTION smartstore_cancel_user_uploads();
