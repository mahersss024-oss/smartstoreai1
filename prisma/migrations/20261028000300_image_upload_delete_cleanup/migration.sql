-- All deletion paths (including legacy clients during rollback) must release
-- final-image manifests for retryable object cleanup.
CREATE FUNCTION smartstore_cancel_deleted_image_upload() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "ListingImageUpload" SET "status" = 'cancelled', "errorCode" = 'image_deleted',
    "leaseToken" = NULL, "leaseUntil" = NULL, "cleanupAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER smartstore_cancel_deleted_image_upload BEFORE DELETE ON "ListingImage"
  FOR EACH ROW EXECUTE FUNCTION smartstore_cancel_deleted_image_upload();
