BEGIN;

-- Drain existing User writes before replacing their evidence trigger function.
-- Reads remain available; all source guards and event immutability are restored
-- atomically before other writers can observe the committed migration.
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "EvidenceEvent" IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION evidence_redact_credentials(document JSONB) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result JSONB; item JSONB; field RECORD;
BEGIN
  IF jsonb_typeof(document) = 'object' THEN
    result := '{}'::jsonb;
    FOR field IN SELECT key, value FROM jsonb_each(document) LOOP
      IF field.key <> 'appleAuthorizationTokens' THEN
        result := result || jsonb_build_object(field.key, evidence_redact_credentials(field.value));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(document) = 'array' THEN
    result := '[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(document) LOOP
      result := result || jsonb_build_array(evidence_redact_credentials(item));
    END LOOP;
    RETURN result;
  END IF;
  RETURN document;
END $$;

CREATE OR REPLACE FUNCTION evidence_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rowdata JSONB; c RECORD; related BOOLEAN;
BEGIN
  rowdata := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'User' AND TG_OP = 'UPDATE' AND
    (to_jsonb(OLD) - ARRAY['lastActiveAt','updatedAt']) = (to_jsonb(NEW) - ARRAY['lastActiveAt','updatedAt']) THEN RETURN NEW; END IF;
  FOR c IN SELECT * FROM "EvidenceCase" WHERE status <> 'disposed' AND (
    (TG_TABLE_NAME = 'User' AND rowdata->>'id' = ANY("participantIds")) OR
    (TG_TABLE_NAME = 'Listing' AND rowdata->>'id' = "listingId") OR
    (TG_TABLE_NAME IN ('ListingImage','Commission') AND rowdata->>'listingId' = "listingId") OR
    (TG_TABLE_NAME = 'Conversation' AND rowdata->>'id' = ANY("conversationIds")) OR
    (TG_TABLE_NAME = 'ConversationMessage' AND rowdata->>'conversationId' = ANY("conversationIds")) OR
    (TG_TABLE_NAME = "sourceType" AND rowdata->>'id' = "sourceId")) ORDER BY id FOR UPDATE LOOP
    related := CASE TG_TABLE_NAME
      WHEN 'User' THEN rowdata->>'id' = ANY(c."participantIds")
      WHEN 'Listing' THEN rowdata->>'id' = c."listingId"
      WHEN 'ListingImage' THEN rowdata->>'listingId' = c."listingId"
      WHEN 'Conversation' THEN rowdata->>'id' = ANY(c."conversationIds")
      WHEN 'ConversationMessage' THEN rowdata->>'conversationId' = ANY(c."conversationIds")
      WHEN 'Commission' THEN rowdata->>'listingId' = c."listingId"
      ELSE TG_TABLE_NAME = c."sourceType" AND rowdata->>'id' = c."sourceId" END;
    IF NOT COALESCE(related,false) THEN CONTINUE; END IF;
    IF c.status = 'disposing' THEN
      IF TG_OP = 'DELETE' OR TG_TABLE_NAME IN ('Report','UserReport') THEN
        RAISE EXCEPTION 'evidence_protected' USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('User','Listing','Report','UserReport','Commission','Conversation') THEN
      RAISE EXCEPTION 'evidence_protected' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'ListingImage' AND (TG_OP = 'DELETE' OR
      (to_jsonb(OLD)->>'originalUrl',to_jsonb(OLD)->>'displayUrl',to_jsonb(OLD)->>'thumbnailUrl') IS DISTINCT FROM
      (rowdata->>'originalUrl',rowdata->>'displayUrl',rowdata->>'thumbnailUrl')) AND EXISTS (
      SELECT 1 FROM "EvidenceAsset" WHERE "caseId" = c.id AND status <> 'stored'
        AND "sourceUrl" = ANY(ARRAY[to_jsonb(OLD)->>'originalUrl',to_jsonb(OLD)->>'displayUrl',to_jsonb(OLD)->>'thumbnailUrl'])
    ) THEN RAISE EXCEPTION 'evidence_copy_pending' USING ERRCODE = '23514'; END IF;
    INSERT INTO "EvidenceEvent" (id,"caseId",action,payload) VALUES (
      md5(random()::text || clock_timestamp()::text),c.id,TG_TABLE_NAME || '.' || lower(TG_OP),
      jsonb_build_object('before',CASE WHEN TG_OP <> 'INSERT' THEN CASE WHEN TG_TABLE_NAME = 'User' THEN evidence_redact_credentials(to_jsonb(OLD)) ELSE to_jsonb(OLD) END END,'after',CASE WHEN TG_OP <> 'DELETE' THEN CASE WHEN TG_TABLE_NAME = 'User' THEN evidence_redact_credentials(to_jsonb(NEW)) ELSE to_jsonb(NEW) END END));
    IF TG_TABLE_NAME IN ('Report','UserReport') AND TG_OP = 'UPDATE' THEN
      UPDATE "EvidenceCase" SET status = CASE WHEN NEW.status::text = 'open' THEN 'open' ELSE 'closed' END,
        "closedAt" = CASE WHEN NEW.status::text = 'open' THEN NULL ELSE COALESCE("closedAt",CURRENT_TIMESTAMP) END,
        "retainUntil" = CASE WHEN NEW.status::text = 'open' THEN NULL WHEN OLD.status::text = 'open' THEN GREATEST("retainUntil",CURRENT_TIMESTAMP + INTERVAL '180 days') ELSE COALESCE("retainUntil",CURRENT_TIMESTAMP + INTERVAL '180 days') END
        WHERE id = c.id;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Only credential fields are removed. IDs, actions, actors, timestamps,
-- evidence records, snapshot contents and their integrity hashes are retained.
-- The exclusive table lock lasts until COMMIT; rollback restores both data and
-- the trigger state if any part of this migration fails.
ALTER TABLE "EvidenceEvent" DISABLE TRIGGER evidence_immutable;
UPDATE "EvidenceEvent"
SET payload = evidence_redact_credentials(payload)
WHERE action IN ('User.update', 'User.delete')
  AND payload IS DISTINCT FROM evidence_redact_credentials(payload);
ALTER TABLE "EvidenceEvent" ENABLE TRIGGER evidence_immutable;

COMMIT;
