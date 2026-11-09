-- Remove historical private snapshots from operation receipts. IDs and outcomes
-- stay available for deduplication; the API reconstructs authorized current rows.
UPDATE "ApiIdempotencyKey"
SET response = jsonb_set(response, '{conversation}', jsonb_build_object('id', response->'conversation'->'id'))
WHERE namespace IN ('conversation_create', 'message_send', 'contact_share', 'conversation_user_report',
  'conversation_user_block', 'conversation_user_unblock', 'conversation_message_delete')
  AND jsonb_typeof(response->'conversation') = 'object';

UPDATE "ApiIdempotencyKey"
SET response = jsonb_set(response, '{message}', jsonb_build_object('id', response->'message'->'id'))
WHERE namespace IN ('message_send', 'contact_share', 'conversation_message_delete')
  AND jsonb_typeof(response->'message') = 'object';
