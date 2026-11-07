BEGIN;

CREATE TYPE "AnalyticsPlatform" AS ENUM ('web', 'ios', 'android');
ALTER TABLE "SiteVisitDaily" ADD COLUMN "platform" "AnalyticsPlatform" NOT NULL DEFAULT 'web';
ALTER TABLE "SiteVisitUnique" ADD COLUMN "platform" "AnalyticsPlatform" NOT NULL DEFAULT 'web',
  ADD COLUMN "lastSessionId" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "SiteVisitUnique" SET "lastSeenAt" = "createdAt";

ALTER TABLE "SiteVisitDaily" DROP CONSTRAINT "SiteVisitDaily_pkey";
ALTER TABLE "SiteVisitDaily" ADD CONSTRAINT "SiteVisitDaily_pkey" PRIMARY KEY ("day", "platform");
DROP INDEX "SiteVisitUnique_day_visitorId_key";
CREATE UNIQUE INDEX "SiteVisitUnique_day_platform_visitorId_key" ON "SiteVisitUnique"("day", "platform", "visitorId");
CREATE INDEX "SiteVisitDaily_platform_day_idx" ON "SiteVisitDaily"("platform", "day");
CREATE INDEX "SiteVisitUnique_platform_day_visitorId_idx" ON "SiteVisitUnique"("platform", "day", "visitorId");

COMMIT;
