-- Add admin resolution tracking to conversation (user) reports.

-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'warn_user';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'restrict_conversation';

-- AlterTable
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "resolution" VARCHAR(32);
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT;
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserReport_resolvedBy_idx" ON "UserReport"("resolvedBy");
