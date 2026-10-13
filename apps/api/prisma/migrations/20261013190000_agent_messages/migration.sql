-- Messages between AI agents of one workspace (ADR-0007, "agents talk to each other").
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromTokenId" TEXT NOT NULL,
    "toTokenId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_messages_workspaceId_idx" ON "agent_messages"("workspaceId");
CREATE INDEX "agent_messages_toTokenId_readAt_idx" ON "agent_messages"("toTokenId", "readAt");

ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_fromTokenId_fkey"
  FOREIGN KEY ("fromTokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_toTokenId_fkey"
  FOREIGN KEY ("toTokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_messages_isolation ON "agent_messages"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_messages"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
