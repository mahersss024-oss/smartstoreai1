-- Legacy registrations are refreshed by the existing native push lifecycle.
-- A token without a verified session expiry must not receive private previews.
ALTER TABLE "MobilePushToken"
  ADD COLUMN "sessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "registrationKey" VARCHAR(36);
