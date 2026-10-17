-- Opportunity manager (R1.2): an explicit, expiring, limited autonomy policy per HH connection and the log of what it did.
-- The policy grants nothing by itself: every send still goes through the executor's reserve checkpoint and the account budget.

ALTER TABLE "opportunity_attempts" ADD COLUMN "initiatedBy" TEXT;

CREATE TABLE "opportunity_policies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "pausedReason" TEXT,
    "minScore" INTEGER NOT NULL DEFAULT 70,
    "minConfidence" TEXT NOT NULL DEFAULT 'medium',
    "requiredFactIds" JSONB NOT NULL DEFAULT '[]',
    "dailyLimit" INTEGER NOT NULL,
    "maxTotal" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "quietStart" TEXT,
    "quietEnd" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opportunity_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_manager_actions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'apply',
    "state" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL DEFAULT '[]',
    "attemptId" TEXT,
    "policyRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_manager_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opportunity_policy_scope" ON "opportunity_policies"("id", "workspaceId");
CREATE INDEX "opportunity_policies_workspaceId_connectionId_idx" ON "opportunity_policies"("workspaceId", "connectionId");
CREATE UNIQUE INDEX "opportunity_manager_once" ON "opportunity_manager_actions"("policyId", "opportunityId");
CREATE INDEX "opportunity_manager_actions_workspaceId_policyId_createdAt_idx" ON "opportunity_manager_actions"("workspaceId", "policyId", "createdAt");

-- Database-level barriers: one live policy per connection; hard caps no code path can exceed.
CREATE UNIQUE INDEX "opportunity_policy_one_live" ON "opportunity_policies"("connectionId") WHERE "state" IN ('active', 'paused');
ALTER TABLE "opportunity_policies" ADD CONSTRAINT "opportunity_policy_limits" CHECK ("dailyLimit" BETWEEN 1 AND 20 AND "maxTotal" BETWEEN 1 AND 100 AND "remaining" BETWEEN 0 AND "maxTotal" AND "minScore" BETWEEN 0 AND 100);

ALTER TABLE "opportunity_policies" ADD CONSTRAINT "opportunity_policies_connectionId_workspaceId_fkey" FOREIGN KEY ("connectionId", "workspaceId") REFERENCES "opportunity_connections"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_policies" ADD CONSTRAINT "opportunity_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_manager_actions" ADD CONSTRAINT "opportunity_manager_actions_policyId_workspaceId_fkey" FOREIGN KEY ("policyId", "workspaceId") REFERENCES "opportunity_policies"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_manager_actions" ADD CONSTRAINT "opportunity_manager_actions_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_manager_actions" ADD CONSTRAINT "opportunity_manager_actions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunity_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_policies_isolation ON "opportunity_policies" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_policies"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "opportunity_manager_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_manager_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_manager_actions_isolation ON "opportunity_manager_actions" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_manager_actions"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
