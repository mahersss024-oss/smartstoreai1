-- Encrypted provider tokens stay with the preserved account, never in its audit history.
ALTER TABLE "User" ADD COLUMN "appleAuthorizationTokens" JSONB;
