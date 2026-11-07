BEGIN;
ALTER TABLE "SiteVisitUnique" ADD COLUMN "seenSessionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "SiteVisitUnique" SET "seenSessionIds" = ARRAY["lastSessionId"]
WHERE "lastSessionId" IS NOT NULL AND platform <> 'web';
COMMIT;
