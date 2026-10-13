-- ORION AI Bridge (ADR-0007): revocable agent tokens and their audit trail.
CREATE TABLE "agent_tokens" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_tokens_tokenHash_key" ON "agent_tokens"("tokenHash");
CREATE INDEX "agent_tokens_workspaceId_idx" ON "agent_tokens"("workspaceId");
CREATE INDEX "agent_tokens_createdById_idx" ON "agent_tokens"("createdById");

ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_audit_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenId" TEXT,
    "tokenName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "status" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_audit_entries_workspaceId_createdAt_idx" ON "agent_audit_entries"("workspaceId", "createdAt");

ALTER TABLE "agent_audit_entries" ADD CONSTRAINT "agent_audit_entries_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_audit_entries" ADD CONSTRAINT "agent_audit_entries_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "agent_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every table with "workspaceId" needs ENABLE + FORCE RLS and a policy.
ALTER TABLE "agent_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_tokens_isolation ON "agent_tokens"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_tokens"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "agent_audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_audit_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_audit_entries_isolation ON "agent_audit_entries"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "agent_audit_entries"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
