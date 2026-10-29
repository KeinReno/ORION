-- Agent Hub: reported runtime sessions (not process attestation).
CREATE TABLE "agent_hub_runtime_sessions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'habitat_observer',
  "status" TEXT NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "capabilities" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "agent_hub_runtime_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_hub_runtime_sessions_workspaceId_expiresAt_idx" ON "agent_hub_runtime_sessions"("workspaceId", "expiresAt");
CREATE INDEX "agent_hub_runtime_sessions_workspaceId_tokenId_idx" ON "agent_hub_runtime_sessions"("workspaceId", "tokenId");

ALTER TABLE "agent_hub_runtime_sessions" ADD CONSTRAINT "agent_hub_runtime_sessions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "agent_hub_runtime_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_hub_runtime_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_hub_runtime_sessions_isolation ON "agent_hub_runtime_sessions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_hub_runtime_sessions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
