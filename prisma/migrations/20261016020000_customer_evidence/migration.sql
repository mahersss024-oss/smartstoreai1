BEGIN;

ALTER TYPE "AdminAuditAction" ADD VALUE 'manage_evidence';

CREATE TABLE "EvidenceCase" (
  "id" TEXT PRIMARY KEY, "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "listingId" TEXT, "participantIds" TEXT[] NOT NULL, "conversationIds" TEXT[] NOT NULL,
  "snapshot" JSONB NOT NULL, "snapshotHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open', "captureStatus" TEXT NOT NULL DEFAULT 'pending',
  "closedAt" TIMESTAMP(3), "retainUntil" TIMESTAMP(3), "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "disposedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "EvidenceCase_sourceType_sourceId_key" ON "EvidenceCase"("sourceType", "sourceId");
CREATE INDEX "EvidenceCase_listingId_status_idx" ON "EvidenceCase"("listingId", "status");
CREATE INDEX "EvidenceCase_participantIds_idx" ON "EvidenceCase" USING GIN ("participantIds");
CREATE INDEX "EvidenceCase_conversationIds_idx" ON "EvidenceCase" USING GIN ("conversationIds");
CREATE TABLE "EvidenceAsset" (
  "id" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL REFERENCES "EvidenceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceUrl" TEXT NOT NULL, "sourceHash" TEXT NOT NULL, "objectKey" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "sha256" TEXT, "mediaType" TEXT, "byteLength" INTEGER, "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT, "leaseUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "EvidenceAsset_objectKey_key" ON "EvidenceAsset"("objectKey");
CREATE UNIQUE INDEX "EvidenceAsset_caseId_sourceHash_key" ON "EvidenceAsset"("caseId", "sourceHash");
CREATE INDEX "EvidenceAsset_caseId_status_idx" ON "EvidenceAsset"("caseId", "status");
CREATE INDEX "EvidenceAsset_sourceHash_status_idx" ON "EvidenceAsset"("sourceHash", "status");
CREATE TABLE "EvidenceEvent" (
  "id" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL REFERENCES "EvidenceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL, "actorId" TEXT, "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EvidenceEvent_caseId_createdAt_id_idx" ON "EvidenceEvent"("caseId", "createdAt", "id");

-- Entity-scoped locks coordinate capture with writes without serializing unrelated listings.
CREATE FUNCTION evidence_write_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d JSONB; lid TEXT; uids TEXT[]; lockname TEXT;
BEGIN
  d := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'User' THEN
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - ARRAY['lastActiveAt','updatedAt']) = (d - ARRAY['lastActiveAt','updatedAt']) THEN RETURN NEW; END IF;
    uids := ARRAY[d->>'id'];
  ELSIF TG_TABLE_NAME = 'Listing' THEN lid := d->>'id'; uids := ARRAY[d->>'sellerId'];
  ELSIF TG_TABLE_NAME = 'ConversationMessage' THEN SELECT "listingId" INTO lid FROM "Conversation" WHERE id = d->>'conversationId';
  ELSIF TG_TABLE_NAME = 'UserReport' THEN
    SELECT "listingId" INTO lid FROM "Conversation" WHERE id = d->>'conversationId';
    uids := ARRAY[d->>'reporterId',d->>'targetUserId'];
  ELSE
    lid := d->>'listingId';
    IF TG_TABLE_NAME = 'Report' THEN
      uids := ARRAY[d->>'reporterId',(SELECT "sellerId" FROM "Listing" WHERE id = lid)];
    END IF;
  END IF;
  FOR lockname IN SELECT DISTINCT k FROM unnest(
    CASE WHEN lid IS NULL THEN ARRAY[]::text[] ELSE ARRAY['listing:' || lid] END ||
    ARRAY(SELECT 'user:' || u FROM unnest(COALESCE(uids,ARRAY[]::text[])) u WHERE u IS NOT NULL)
  ) k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(771204,hashtext(lockname));
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['Listing','ListingImage','Conversation','ConversationMessage','Commission','Report','UserReport'] LOOP
    EXECUTE format('CREATE TRIGGER evidence_00_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION evidence_write_lock()', t);
  END LOOP;
  CREATE TRIGGER evidence_00_lock BEFORE UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION evidence_write_lock();
END $$;

CREATE FUNCTION evidence_enqueue_images(cid TEXT, lid TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "EvidenceAsset" ("id", "caseId", "sourceUrl", "sourceHash", "objectKey")
  SELECT encode(sha256(convert_to(cid || u.url,'UTF8')),'hex'), cid, u.url, encode(sha256(convert_to(u.url,'UTF8')),'hex'), 'cases/' || cid || '/' || encode(sha256(convert_to(u.url,'UTF8')),'hex')
  FROM "ListingImage" i CROSS JOIN LATERAL unnest(ARRAY[i."originalUrl", i."displayUrl", i."thumbnailUrl"]) u(url)
  WHERE i."listingId" = lid AND u.url <> ''
  ON CONFLICT ("caseId", "sourceHash") DO NOTHING;
END $$;

CREATE FUNCTION evidence_open_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid TEXT; cid TEXT; convs TEXT[]; participants TEXT[]; doc JSONB; seller TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Report' THEN
    lid := NEW."listingId";
    SELECT "sellerId" INTO seller FROM "Listing" WHERE id = lid;
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::TEXT[]) INTO convs FROM "Conversation"
      WHERE "listingId" = lid AND "buyerId" = NEW."reporterId" AND "sellerId" = seller;
    participants := ARRAY[NEW."reporterId", seller];
  ELSE
    SELECT "listingId" INTO lid FROM "Conversation" WHERE id = NEW."conversationId";
    convs := CASE WHEN NEW."conversationId" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[NEW."conversationId"] END;
    participants := ARRAY[NEW."reporterId", NEW."targetUserId"];
  END IF;
  cid := TG_TABLE_NAME || ':' || NEW.id;
  doc := jsonb_build_object(
    'capturedAt', CURRENT_TIMESTAMP, 'report', to_jsonb(NEW),
    'listing', (SELECT to_jsonb(l) FROM "Listing" l WHERE id = lid),
    'images', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM "ListingImage" i WHERE "listingId" = lid), '[]'::jsonb),
    'participants', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phoneNumber',"phoneNumber")) FROM "User" WHERE id = ANY(participants)), '[]'::jsonb),
    'conversations', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM "Conversation" c WHERE id = ANY(convs)), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY "createdAt", id) FROM "ConversationMessage" m WHERE "conversationId" = ANY(convs) AND type <> 'conversation_hidden'), '[]'::jsonb),
    'commissions', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM "Commission" c WHERE "listingId" = lid), '[]'::jsonb)
  );
  INSERT INTO "EvidenceCase" (id,"sourceType","sourceId","listingId","participantIds","conversationIds",snapshot,"snapshotHash",status,"closedAt","retainUntil")
    VALUES (cid,TG_TABLE_NAME,NEW.id,lid,participants,convs,doc,encode(sha256(convert_to(doc::text,'UTF8')),'hex'),
      CASE WHEN NEW.status::text = 'open' THEN 'open' ELSE 'closed' END,
      CASE WHEN NEW.status::text <> 'open' THEN CURRENT_TIMESTAMP END,
      CASE WHEN NEW.status::text <> 'open' THEN CURRENT_TIMESTAMP + INTERVAL '180 days' END)
    ON CONFLICT ("sourceType","sourceId") DO NOTHING;
  PERFORM evidence_enqueue_images(cid,lid);
  UPDATE "EvidenceCase" SET "captureStatus" = CASE WHEN EXISTS (SELECT 1 FROM "EvidenceAsset" WHERE "caseId" = cid) THEN 'pending' ELSE 'complete' END WHERE id = cid;
  INSERT INTO "EvidenceEvent" (id,"caseId",action,payload) VALUES (md5(random()::text || clock_timestamp()::text),cid,'case.opened',jsonb_build_object('legacy',TG_ARGV[0] = 'legacy'));
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_capture AFTER INSERT ON "Report" FOR EACH ROW EXECUTE FUNCTION evidence_open_case();
CREATE TRIGGER evidence_capture AFTER INSERT ON "UserReport" FOR EACH ROW EXECUTE FUNCTION evidence_open_case();

CREATE FUNCTION evidence_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
      jsonb_build_object('before',CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,'after',CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END));
    IF TG_TABLE_NAME IN ('Report','UserReport') AND TG_OP = 'UPDATE' THEN
      UPDATE "EvidenceCase" SET status = CASE WHEN NEW.status::text = 'open' THEN 'open' ELSE 'closed' END,
        "closedAt" = CASE WHEN NEW.status::text = 'open' THEN NULL ELSE COALESCE("closedAt",CURRENT_TIMESTAMP) END,
        "retainUntil" = CASE WHEN NEW.status::text = 'open' THEN NULL WHEN OLD.status::text = 'open' THEN GREATEST("retainUntil",CURRENT_TIMESTAMP + INTERVAL '180 days') ELSE COALESCE("retainUntil",CURRENT_TIMESTAMP + INTERVAL '180 days') END
        WHERE id = c.id;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['User','Listing','ListingImage','Conversation','ConversationMessage','Commission','Report','UserReport'] LOOP
    EXECUTE format('CREATE TRIGGER evidence_guard BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION evidence_record_change()',t);
  END LOOP;
END $$;

-- Preserve later messages and newly added images without changing customer workflows.
CREATE FUNCTION evidence_record_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT * FROM "EvidenceCase" WHERE status NOT IN ('disposed','disposing') AND
    ((TG_TABLE_NAME = 'ListingImage' AND "listingId" = to_jsonb(NEW)->>'listingId') OR
     (TG_TABLE_NAME = 'ConversationMessage' AND to_jsonb(NEW)->>'conversationId' = ANY("conversationIds"))) LOOP
    INSERT INTO "EvidenceEvent" (id,"caseId",action,payload) VALUES (md5(random()::text || clock_timestamp()::text),c.id,TG_TABLE_NAME || '.insert',jsonb_build_object('after',to_jsonb(NEW)));
    IF TG_TABLE_NAME = 'ListingImage' THEN
      PERFORM evidence_enqueue_images(c.id,c."listingId");
      UPDATE "EvidenceCase" SET "captureStatus" = CASE WHEN EXISTS (SELECT 1 FROM "EvidenceAsset" WHERE "caseId" = c.id AND status <> 'stored') THEN 'pending' ELSE 'complete' END WHERE id = c.id;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_insert AFTER INSERT ON "ListingImage" FOR EACH ROW EXECUTE FUNCTION evidence_record_insert();
CREATE TRIGGER evidence_images_updated AFTER UPDATE ON "ListingImage" FOR EACH ROW EXECUTE FUNCTION evidence_record_insert();
CREATE TRIGGER evidence_insert AFTER INSERT ON "ConversationMessage" FOR EACH ROW EXECUTE FUNCTION evidence_record_insert();

-- Existing reports are captured from surviving records, never represented as historical originals.
CREATE TRIGGER evidence_backfill AFTER UPDATE ON "Report" FOR EACH ROW WHEN (OLD.id = NEW.id) EXECUTE FUNCTION evidence_open_case('legacy');
CREATE TRIGGER evidence_backfill AFTER UPDATE ON "UserReport" FOR EACH ROW WHEN (OLD.id = NEW.id) EXECUTE FUNCTION evidence_open_case('legacy');
UPDATE "Report" SET "updatedAt" = "updatedAt";
UPDATE "UserReport" SET "updatedAt" = "updatedAt";
DROP TRIGGER evidence_backfill ON "Report";
DROP TRIGGER evidence_backfill ON "UserReport";

CREATE FUNCTION evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'EvidenceCase' THEN
    IF TG_OP = 'DELETE' AND OLD.status <> 'disposed' THEN RAISE EXCEPTION 'evidence_protected'; END IF;
    IF TG_OP = 'UPDATE' AND (OLD.id,OLD."sourceType",OLD."sourceId",OLD."createdAt",OLD.snapshot,OLD."snapshotHash",OLD."participantIds",OLD."conversationIds",OLD."listingId") IS DISTINCT FROM
      (NEW.id,NEW."sourceType",NEW."sourceId",NEW."createdAt",NEW.snapshot,NEW."snapshotHash",NEW."participantIds",NEW."conversationIds",NEW."listingId") AND
      NOT (OLD.id = NEW.id AND OLD."sourceType" = NEW."sourceType" AND OLD."sourceId" = NEW."sourceId" AND OLD."createdAt" = NEW."createdAt" AND OLD.status = 'disposing' AND NEW.status = 'disposed' AND NEW.snapshot = '{}'::jsonb AND NEW."snapshotHash" = '' AND NEW."participantIds" = ARRAY[]::text[] AND NEW."conversationIds" = ARRAY[]::text[] AND NEW."listingId" IS NULL) THEN
      RAISE EXCEPTION 'immutable_evidence_snapshot';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "EvidenceCase" WHERE id = OLD."caseId" AND status IN ('disposing','disposed')) THEN RAISE EXCEPTION 'evidence_protected'; END IF;
  ELSIF TG_TABLE_NAME = 'EvidenceEvent' THEN
    RAISE EXCEPTION 'immutable_evidence_event';
  ELSIF TG_TABLE_NAME = 'EvidenceAsset' AND
    (OLD.id,OLD."caseId",OLD."sourceUrl",OLD."sourceHash",OLD."objectKey") IS DISTINCT FROM
    (NEW.id,NEW."caseId",NEW."sourceUrl",NEW."sourceHash",NEW."objectKey") THEN RAISE EXCEPTION 'immutable_evidence_asset';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON "EvidenceCase" FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON "EvidenceEvent" FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON "EvidenceAsset" FOR EACH ROW EXECUTE FUNCTION evidence_immutable();

COMMIT;
