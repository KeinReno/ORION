-- Agent Manager (TZ-03): autonomy mode, permission matrix, project limits, journal summary/undo, proposals with a diff.
-- Additive only; the RLS policies of all three tables are workspace-based and already cover the new columns.

-- Tokens that exist now keep behaving exactly as before: before this migration a token wrote at once (create AND update)
-- inside its scopes and could only PROPOSE deletion. That is the `manager` mode with no limits, no project fence, no
-- "never" flags and no stored matrix (permissions = NULL → derived from the scopes). New tokens default to `assistant`.
ALTER TABLE "agent_tokens" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'manager';
ALTER TABLE "agent_tokens" ALTER COLUMN "mode" SET DEFAULT 'assistant';
ALTER TABLE "agent_tokens" ADD COLUMN "permissions" JSONB;
ALTER TABLE "agent_tokens" ADD COLUMN "allowedProjectIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "agent_tokens" ADD COLUMN "forbidden" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "agent_tokens" ADD COLUMN "writeLimitPerHour" INTEGER;
ALTER TABLE "agent_tokens" ADD COLUMN "autoCommitProjectIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "agent_audit_entries" ADD COLUMN "module" TEXT;
ALTER TABLE "agent_audit_entries" ADD COLUMN "summary" TEXT;
ALTER TABLE "agent_audit_entries" ADD COLUMN "objectType" TEXT;
ALTER TABLE "agent_audit_entries" ADD COLUMN "objectId" TEXT;
ALTER TABLE "agent_audit_entries" ADD COLUMN "undoneAt" TIMESTAMP(3);
ALTER TABLE "agent_audit_entries" ADD COLUMN "wrote" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "agent_audit_entries_tokenId_createdAt_idx" ON "agent_audit_entries"("tokenId", "createdAt");

ALTER TABLE "agent_proposals" ADD COLUMN "patch" JSONB;
ALTER TABLE "agent_proposals" ADD COLUMN "diff" JSONB;
ALTER TABLE "agent_proposals" ADD COLUMN "expiresAt" TIMESTAMP(3);
