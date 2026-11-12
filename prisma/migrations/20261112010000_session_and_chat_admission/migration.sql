BEGIN;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "chatUsage" JSONB NOT NULL DEFAULT '{}';

-- Admission bookkeeping must not create evidence/profile change events or take
-- evidence entity locks. Preserve the installed guards except their existing
-- exclusion of routine activity timestamps, to which we add chatUsage only.
DO $$
DECLARE fn regprocedure; definition text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['evidence_write_lock()'::regprocedure, 'evidence_record_change()'::regprocedure] LOOP
    definition := pg_get_functiondef(fn);
    IF position('ARRAY[''lastActiveAt'',''updatedAt'']' IN definition) = 0 THEN
      RAISE EXCEPTION 'Unexpected account evidence guard definition';
    END IF;
    EXECUTE replace(definition, 'ARRAY[''lastActiveAt'',''updatedAt'']', 'ARRAY[''lastActiveAt'',''updatedAt'',''chatUsage'']');
  END LOOP;
END $$;

-- Existing disabled accounts must require fresh sign-in after restoration too.
UPDATE "User" SET "sessionVersion" = 1 WHERE "deletedAt" IS NOT NULL;
CREATE FUNCTION smartstore_revoke_deactivated_sessions() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
    NEW."sessionVersion" := OLD."sessionVersion" + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER smartstore_revoke_deactivated_sessions
BEFORE UPDATE OF "deletedAt" ON "User"
FOR EACH ROW EXECUTE FUNCTION smartstore_revoke_deactivated_sessions();
COMMIT;
