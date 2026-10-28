CREATE TABLE "NotificationDeliveryJob" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDeliveryJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationDeliveryJob_completedAt_failedAt_nextAttemptAt_idx" ON "NotificationDeliveryJob"("completedAt", "failedAt", "nextAttemptAt");
CREATE INDEX "NotificationDeliveryJob_leaseUntil_idx" ON "NotificationDeliveryJob"("leaseUntil");
