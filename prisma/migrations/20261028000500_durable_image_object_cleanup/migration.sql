CREATE TABLE "ImageObjectCleanup" (
  "id" TEXT NOT NULL,
  "imageId" TEXT NOT NULL,
  "ownerId" TEXT,
  "urls" TEXT[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "cleanupAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImageObjectCleanup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImageObjectCleanup_imageId_key" ON "ImageObjectCleanup"("imageId");
CREATE INDEX "ImageObjectCleanup_cleanupAt_nextAttemptAt_idx" ON "ImageObjectCleanup"("cleanupAt", "nextAttemptAt");

-- Capture references before cascades erase them, including administrative and
-- account deletion paths. There is deliberately no FK back to deleted content.
CREATE FUNCTION smartstore_queue_deleted_image_object() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "ImageObjectCleanup" ("id", "imageId", "urls", "updatedAt")
    VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text), OLD."id",
      ARRAY[OLD."originalUrl", OLD."displayUrl", OLD."thumbnailUrl"], CURRENT_TIMESTAMP)
    ON CONFLICT ("imageId") DO NOTHING;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ListingImage_object_cleanup" BEFORE DELETE ON "ListingImage"
  FOR EACH ROW EXECUTE FUNCTION smartstore_queue_deleted_image_object();

-- The processor independently proves the owner-scoped profile namespace.
-- Legacy/provider/arbitrary URLs are cleared without granting deletion rights.
CREATE FUNCTION smartstore_queue_deleted_profile_object() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."picture" IS NOT NULL AND OLD."picture" <> '' THEN
    INSERT INTO "ImageObjectCleanup" ("id", "imageId", "ownerId", "urls", "updatedAt")
      VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text),
        'profile:' || OLD."id" || ':' || md5(OLD."picture"), OLD."id", ARRAY[OLD."picture"], CURRENT_TIMESTAMP)
      ON CONFLICT ("imageId") DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_profile_object_cleanup" BEFORE DELETE ON "User"
  FOR EACH ROW EXECUTE FUNCTION smartstore_queue_deleted_profile_object();
