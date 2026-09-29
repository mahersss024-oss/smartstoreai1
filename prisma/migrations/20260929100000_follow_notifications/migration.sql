CREATE TABLE "FollowNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "url" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowNotification_userId_listingId_key" ON "FollowNotification"("userId", "listingId");
CREATE INDEX "FollowNotification_userId_readAt_createdAt_idx" ON "FollowNotification"("userId", "readAt", "createdAt");
CREATE INDEX "FollowNotification_listingId_idx" ON "FollowNotification"("listingId");

ALTER TABLE "FollowNotification" ADD CONSTRAINT "FollowNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowNotification" ADD CONSTRAINT "FollowNotification_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
