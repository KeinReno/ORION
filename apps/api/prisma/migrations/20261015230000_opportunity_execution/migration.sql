-- Opportunity execution (R1.1): HH account connection, exact-payload attempts, one-time grants, persistent daily budget.
-- Secrets never live here: only hashes of the runner token / pairing code and an opaque account id reported by the local runner.

CREATE TABLE "opportunity_connections" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'hh',
    "accountLabel" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "accountDisplay" TEXT,
    "runnerId" TEXT,
    "runnerTokenHash" TEXT,
    "pairingHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'pending_link',
    "pausedReason" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 5,
    "minIntervalSec" INTEGER NOT NULL DEFAULT 180,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "runnerSeenAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opportunity_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_attempts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL DEFAULT 'apply',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'awaiting_approval',
    "reviewNotes" JSONB NOT NULL DEFAULT '[]',
    "reviewAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "submitReserved" BOOLEAN NOT NULL DEFAULT false,
    "submitStartedAt" TIMESTAMP(3),
    "leaseHash" TEXT,
    "leaseRunnerId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "confirmationBasis" TEXT,
    "errorCode" TEXT,
    "message" TEXT,
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "opportunity_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opportunity_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "opportunity_budgets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opportunity_budgets_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "opportunity_connections_runnerTokenHash_key" ON "opportunity_connections"("runnerTokenHash");
CREATE UNIQUE INDEX "opportunity_connections_pairingHash_key" ON "opportunity_connections"("pairingHash");
CREATE UNIQUE INDEX "opportunity_connection_scope" ON "opportunity_connections"("id", "workspaceId");
CREATE INDEX "opportunity_connections_workspaceId_idx" ON "opportunity_connections"("workspaceId");
CREATE UNIQUE INDEX "opportunity_attempt_idem" ON "opportunity_attempts"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "opportunity_attempt_scope" ON "opportunity_attempts"("id", "workspaceId");
CREATE INDEX "opportunity_attempts_workspaceId_connectionId_state_idx" ON "opportunity_attempts"("workspaceId", "connectionId", "state");
CREATE INDEX "opportunity_grants_workspaceId_attemptId_idx" ON "opportunity_grants"("workspaceId", "attemptId");
CREATE UNIQUE INDEX "opportunity_budget_key" ON "opportunity_budgets"("workspaceId", "accountKey", "actionType", "localDate");

-- Database-level barriers (not checks in code):
--  * one live-or-successful attempt per vacancy and profile: a second idempotency key cannot apply twice;
--  * one active grant per attempt;
--  * the daily counter can never be negative or exceed a hard cap.
CREATE UNIQUE INDEX "opportunity_attempt_one_live" ON "opportunity_attempts"("workspaceId", "opportunityId", "profileId", "actionType")
  WHERE "state" IN ('awaiting_approval', 'queued', 'running', 'sent_unconfirmed', 'confirmed', 'already_exists');
CREATE UNIQUE INDEX "opportunity_connection_one_per_profile" ON "opportunity_connections"("workspaceId", "profileId") WHERE "state" <> 'revoked';
CREATE UNIQUE INDEX "opportunity_grant_one_active" ON "opportunity_grants"("attemptId") WHERE "state" = 'active';
ALTER TABLE "opportunity_budgets" ADD CONSTRAINT "opportunity_budget_used_range" CHECK ("used" >= 0 AND "used" <= 1000);
ALTER TABLE "opportunity_connections" ADD CONSTRAINT "opportunity_connection_limits" CHECK ("dailyLimit" BETWEEN 1 AND 20 AND "minIntervalSec" BETWEEN 60 AND 3600);

-- A draft needs a composite-unique key for the attempt foreign key below
CREATE UNIQUE INDEX "opportunity_draft_scope" ON "opportunity_drafts"("id", "workspaceId");

-- Composite foreign keys: a reference can never cross a workspace
ALTER TABLE "opportunity_connections" ADD CONSTRAINT "opportunity_connections_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_connections" ADD CONSTRAINT "opportunity_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_attempts" ADD CONSTRAINT "opportunity_attempts_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_attempts" ADD CONSTRAINT "opportunity_attempts_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_attempts" ADD CONSTRAINT "opportunity_attempts_connectionId_workspaceId_fkey" FOREIGN KEY ("connectionId", "workspaceId") REFERENCES "opportunity_connections"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_attempts" ADD CONSTRAINT "opportunity_attempts_draftId_workspaceId_fkey" FOREIGN KEY ("draftId", "workspaceId") REFERENCES "opportunity_drafts"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_attempts" ADD CONSTRAINT "opportunity_attempts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_grants" ADD CONSTRAINT "opportunity_grants_attemptId_workspaceId_fkey" FOREIGN KEY ("attemptId", "workspaceId") REFERENCES "opportunity_attempts"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_grants" ADD CONSTRAINT "opportunity_grants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_budgets" ADD CONSTRAINT "opportunity_budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security
ALTER TABLE "opportunity_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_connections_isolation ON "opportunity_connections" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_connections"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "opportunity_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_attempts_isolation ON "opportunity_attempts" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_attempts"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "opportunity_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_grants_isolation ON "opportunity_grants" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_grants"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "opportunity_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_budgets_isolation ON "opportunity_budgets" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_budgets"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
