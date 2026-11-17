-- 11: Workbench (Architect) — пользовательские процессы. Граф целиком в jsonb,
-- одна запись на процесс; запись процесса заменяет граф транзакционно.

CREATE TABLE "development_workflows" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "nodes" JSONB NOT NULL DEFAULT '[]',
  "edges" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "development_workflows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "development_workflows_workspaceId_updatedAt_idx"
  ON "development_workflows"("workspaceId", "updatedAt");

ALTER TABLE "development_workflows" ADD CONSTRAINT "development_workflows_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The same membership boundary as the other workspace-owned tables (RLS).
ALTER TABLE "development_workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_workflows" FORCE ROW LEVEL SECURITY;

CREATE POLICY development_workflows_isolation
  ON "development_workflows"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_workflows"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_workflows"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "development_workflows" TO orion_app, orion_system;
