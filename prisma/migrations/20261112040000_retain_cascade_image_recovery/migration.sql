-- Cascades/profile replacements are authoritative removals too. Preserve UTC
-- queue timestamps and durable manifests independently of deleted parent rows.
CREATE OR REPLACE FUNCTION smartstore_queue_deleted_image_object() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "ImageObjectCleanup" ("id", "imageId", "urls", "preserveForRecovery", "updatedAt")
    VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text), OLD."id",
      ARRAY[OLD."originalUrl", OLD."displayUrl", OLD."thumbnailUrl"], true, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT ("imageId") DO UPDATE SET "preserveForRecovery" = true;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION smartstore_queue_deleted_profile_object() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."picture" IS NOT NULL AND OLD."picture" <> '' THEN
    INSERT INTO "ImageObjectCleanup" ("id", "imageId", "ownerId", "urls", "preserveForRecovery", "updatedAt")
      VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text),
        'profile:' || OLD."id" || ':' || md5(OLD."picture"), OLD."id", ARRAY[OLD."picture"], true, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT ("imageId") DO UPDATE SET "preserveForRecovery" = true;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Upgrade existing authoritative receipts, including the profile trigger's MD5
-- IDs, before they can bypass the explicit SHA256 receipt's retention guard.
UPDATE "ImageObjectCleanup" SET "preserveForRecovery" = true
WHERE "cleanupAt" IS NULL AND "imageId" NOT LIKE 'evidence:%'
  AND "imageId" NOT LIKE 'legacy-upload:%' AND "imageId" NOT LIKE 'direct-upload:%';
