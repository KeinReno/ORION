-- UI-05: structured project status updates (append-only manual reports).
CREATE TABLE "project_status_updates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "blocker" TEXT NOT NULL DEFAULT '',
    "nextStep" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_updates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_status_updates_workspaceId_idx" ON "project_status_updates"("workspaceId");
CREATE INDEX "project_status_updates_projectId_createdAt_idx" ON "project_status_updates"("projectId", "createdAt");

ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- authorId -> users, like task_comments.userId: attribution is a global User
-- fact, so removing the author from the workspace never touches the report.
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every table with "workspaceId" needs ENABLE + FORCE RLS and a policy
-- (api-rls.integration.test.ts asserts it structurally).
ALTER TABLE "project_status_updates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_status_updates" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_status_updates_isolation ON "project_status_updates"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "project_status_updates"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
