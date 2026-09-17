-- Add a soft-delete marker for user accounts.
-- The platform owner deletes accounts permanently; appointed admins only
-- soft-delete (set deletedAt). Soft-deleted users can no longer sign in and
-- are hidden from admin listings.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
