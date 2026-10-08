CREATE TYPE "MobilePushPlatform" AS ENUM ('ios', 'android');

CREATE TABLE "MobilePushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "MobilePushPlatform" NOT NULL,
    "appVersion" TEXT,
    "locale" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobilePushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobilePushToken_token_key" ON "MobilePushToken"("token");
CREATE INDEX "MobilePushToken_userId_isActive_idx" ON "MobilePushToken"("userId", "isActive");
CREATE INDEX "MobilePushToken_platform_isActive_idx" ON "MobilePushToken"("platform", "isActive");
CREATE INDEX "MobilePushToken_isActive_updatedAt_idx" ON "MobilePushToken"("isActive", "updatedAt");

ALTER TABLE "MobilePushToken" ADD CONSTRAINT "MobilePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
