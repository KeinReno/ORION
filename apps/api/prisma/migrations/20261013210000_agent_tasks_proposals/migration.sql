-- Structured jobs between agents, and human-approved dangerous actions (ADR-0007).
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromTokenId" TEXT NOT NULL,
    "toTokenId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_tasks_workspaceId_idx" ON "agent_tasks"("workspaceId");
CREATE INDEX "agent_tasks_toTokenId_status_idx" ON "agent_tasks"("toTokenId", "status");
CREATE INDEX "agent_tasks_fromTokenId_idx" ON "agent_tasks"("fromTokenId");
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_fromTokenId_fkey"
  FOREIGN KEY ("fromTokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_toTokenId_fkey"
  FOREIGN KEY ("toTokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_proposals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "agent_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_proposals_workspaceId_status_idx" ON "agent_proposals"("workspaceId", "status");
CREATE INDEX "agent_proposals_tokenId_idx" ON "agent_proposals"("tokenId");
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "agent_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_tasks_isolation ON "agent_tasks"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_tasks"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "agent_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_proposals_isolation ON "agent_proposals"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_proposals"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
