-- A profile reference can also be cleared by PATCH or account maintenance.
-- Reuse the durable manifest capture before losing that reference. This is an
-- AFTER trigger: the DELETE trigger's return value must not undo a user update.
CREATE TRIGGER "User_changed_profile_object_cleanup"
  AFTER UPDATE OF "picture" ON "User"
  FOR EACH ROW
  WHEN (OLD."picture" IS DISTINCT FROM NEW."picture")
  EXECUTE FUNCTION smartstore_queue_deleted_profile_object();
