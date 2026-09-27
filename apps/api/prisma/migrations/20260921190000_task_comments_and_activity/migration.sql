-- S17: task comments + status/assignee/due audit log.

CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_comments_workspaceId_idx" ON "task_comments"("workspaceId");
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- userId -> users, Cascade: comment authorship is a global User fact, not a
-- WorkspaceMember one. Removing a member from the workspace never touches
-- this row (no FK to workspace_members at all) — history survives member
-- removal by construction. Only a full account deletion (which this app
-- does not implement) would cascade here.
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_activities" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_activities_workspaceId_idx" ON "task_activities"("workspaceId");
CREATE INDEX "task_activities_taskId_createdAt_idx" ON "task_activities"("taskId", "createdAt");

ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — same flat membership-check shape as every other workspace-owned
-- table (see CLAUDE.md "Postgres RLS"); the structural integration test
-- asserts ENABLE + FORCE + a policy for every table carrying "workspaceId".

ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_comments_isolation ON "task_comments"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_comments"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_activities_isolation ON "task_activities"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_activities"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
