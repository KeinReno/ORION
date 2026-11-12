-- Agent Hub 2.0 (task 09): delegation branches, approval gate and result summary.
-- Additive only: existing columns and statuses keep their meaning, so the durable
-- journal and the previous client survive the migration.

ALTER TABLE "agent_hub_executions"
  ADD COLUMN "parentExecutionId" TEXT,
  ADD COLUMN "delegationDepth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delegatedToProfileId" TEXT,
  ADD COLUMN "delegationChain" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "delegationPayload" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "approval" JSONB,
  ADD COLUMN "resultSummary" TEXT;

CREATE INDEX "agent_hub_executions_workspaceId_status_idx" ON "agent_hub_executions"("workspaceId", "status");
CREATE INDEX "agent_hub_executions_parentExecutionId_idx" ON "agent_hub_executions"("parentExecutionId");

-- `reassigned` is terminal as well: the replacement branch must be openable at once.
DROP INDEX "agent_hub_one_active_execution_per_target";
CREATE UNIQUE INDEX "agent_hub_one_active_execution_per_target"
  ON "agent_hub_executions"("workspaceId", "targetKind", "targetId")
  WHERE "status" NOT IN ('done', 'failed', 'canceled', 'reassigned');
