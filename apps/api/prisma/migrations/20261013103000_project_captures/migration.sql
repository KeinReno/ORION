-- Ideas and problems pinned to a project (plugins projects-ideas / projects-problems).
CREATE TYPE "ProjectCaptureKind" AS ENUM ('idea', 'problem');
CREATE TYPE "ProjectCaptureStatus" AS ENUM ('open', 'promoted', 'dismissed');
CREATE TYPE "ProjectCaptureSeverity" AS ENUM ('annoyance', 'bug', 'fix');

CREATE TABLE "project_captures" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectCaptureKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "ProjectCaptureStatus" NOT NULL DEFAULT 'open',
    "severity" "ProjectCaptureSeverity",
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_captures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_captures_workspaceId_idx" ON "project_captures"("workspaceId");
CREATE INDEX "project_captures_projectId_kind_idx" ON "project_captures"("projectId", "kind");
CREATE INDEX "project_captures_taskId_idx" ON "project_captures"("taskId");

ALTER TABLE "project_captures" ADD CONSTRAINT "project_captures_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_captures" ADD CONSTRAINT "project_captures_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_captures" ADD CONSTRAINT "project_captures_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every table with "workspaceId" needs ENABLE + FORCE RLS and a policy
-- (api-rls.integration.test.ts asserts it structurally).
ALTER TABLE "project_captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_captures" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_captures_isolation ON "project_captures"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "project_captures"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
