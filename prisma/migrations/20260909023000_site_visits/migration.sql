-- CreateTable
CREATE TABLE "SiteVisitDaily" (
    "day" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisitDaily_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "SiteVisitUnique" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisitUnique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisitUnique_day_createdAt_idx" ON "SiteVisitUnique"("day", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteVisitUnique_day_visitorId_key" ON "SiteVisitUnique"("day", "visitorId");
