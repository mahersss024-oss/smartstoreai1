CREATE TABLE IF NOT EXISTS "UserReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "conversationId" TEXT,
  "reason" VARCHAR(120) NOT NULL,
  "details" VARCHAR(1000),
  "status" "ReportStatus" NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id" TEXT NOT NULL,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "conversationId" TEXT,
  "reason" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserReport_status_createdAt_idx" ON "UserReport"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "UserReport_reporterId_createdAt_idx" ON "UserReport"("reporterId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserReport_targetUserId_status_idx" ON "UserReport"("targetUserId", "status");
CREATE INDEX IF NOT EXISTS "UserReport_conversationId_idx" ON "UserReport"("conversationId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_createdAt_idx" ON "UserBlock"("blockedId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserBlock_conversationId_idx" ON "UserBlock"("conversationId");

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
