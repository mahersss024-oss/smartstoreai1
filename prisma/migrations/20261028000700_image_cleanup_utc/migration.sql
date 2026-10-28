-- Prisma represents timestamp-without-time-zone values as UTC. A queue row
-- created by a SQL trigger must not inherit the database session's local zone.
ALTER TABLE "ImageObjectCleanup"
  ALTER COLUMN "nextAttemptAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  ALTER COLUMN "createdAt" SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

CREATE OR REPLACE FUNCTION smartstore_queue_deleted_image_object() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "ImageObjectCleanup" ("id", "imageId", "urls", "updatedAt")
    VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text), OLD."id",
      ARRAY[OLD."originalUrl", OLD."displayUrl", OLD."thumbnailUrl"], CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT ("imageId") DO NOTHING;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION smartstore_queue_deleted_profile_object() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."picture" IS NOT NULL AND OLD."picture" <> '' THEN
    INSERT INTO "ImageObjectCleanup" ("id", "imageId", "ownerId", "urls", "updatedAt")
      VALUES ('ioc_' || md5(random()::text || clock_timestamp()::text),
        'profile:' || OLD."id" || ':' || md5(OLD."picture"), OLD."id", ARRAY[OLD."picture"], CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT ("imageId") DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
