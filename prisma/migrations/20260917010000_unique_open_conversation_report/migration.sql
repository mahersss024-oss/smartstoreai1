-- Prevent concurrent requests from creating duplicate open reports.
WITH "rankedOpenReports" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "reporterId", "targetUserId", "conversationId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "duplicateRank"
  FROM "UserReport"
  WHERE "status" = 'open' AND "conversationId" IS NOT NULL
)
UPDATE "UserReport"
SET
  "status" = 'dismissed',
  "resolution" = 'dismiss',
  "resolvedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "rankedOpenReports"
WHERE
  "UserReport"."id" = "rankedOpenReports"."id"
  AND "rankedOpenReports"."duplicateRank" > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "UserReport_unique_open_conversation_report"
ON "UserReport"("reporterId", "targetUserId", "conversationId")
WHERE "status" = 'open' AND "conversationId" IS NOT NULL;
