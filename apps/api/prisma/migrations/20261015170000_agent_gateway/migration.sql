-- Agent Gateway (TZ-02): idempotency ledger for POST /ai/v1/capture + agent attribution on Inbox entries.
ALTER TABLE "inbox_items" ADD COLUMN "createdByAgent" TEXT;

CREATE TABLE "agent_captures" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_captures_pkey" PRIMARY KEY ("id")
);

-- The barrier: a retry or a racing duplicate cannot create a second record for the same key.
CREATE UNIQUE INDEX "agent_captures_tokenId_idempotencyKey_key" ON "agent_captures"("tokenId", "idempotencyKey");
CREATE INDEX "agent_captures_workspaceId_idx" ON "agent_captures"("workspaceId");

ALTER TABLE "agent_captures" ADD CONSTRAINT "agent_captures_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_captures" ADD CONSTRAINT "agent_captures_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_captures" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_captures_isolation ON "agent_captures"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_captures"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
