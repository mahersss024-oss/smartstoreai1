ALTER TABLE "ConversationMessage" ADD COLUMN "type" VARCHAR(32) NOT NULL DEFAULT 'text';
ALTER TABLE "ConversationMessage" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

