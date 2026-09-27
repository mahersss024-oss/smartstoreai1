-- Track authenticated activity using the existing session lifetime.
ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- Use explicit audit actions for the two new administrative workflows.
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'maintenance_cleanup';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'update_site_message';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'update_listing';

CREATE TYPE "SiteMessageType" AS ENUM ('info', 'warning', 'maintenance');

CREATE TABLE "SiteMessage" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "message" VARCHAR(500) NOT NULL,
    "type" "SiteMessageType" NOT NULL DEFAULT 'info',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "User_deletedAt_lastActiveAt_idx" ON "User"("deletedAt", "lastActiveAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
CREATE INDEX "SiteMessage_isEnabled_expiresAt_idx" ON "SiteMessage"("isEnabled", "expiresAt");

ALTER TABLE "SiteMessage"
ADD CONSTRAINT "SiteMessage_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
