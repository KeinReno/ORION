-- PROJECT LOGBOOK: authored entries, live task references and directed project links.
CREATE TYPE "ProjectLogKind" AS ENUM ('observation', 'decision', 'change');
CREATE TYPE "ProjectRelationType" AS ENUM ('continues', 'replaces', 'based_on', 'depends_on', 'related');

CREATE TABLE "project_log_entries" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
  "kind" "ProjectLogKind" NOT NULL, "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_log_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_log_entries_workspaceId_idx" ON "project_log_entries"("workspaceId");
CREATE INDEX "project_log_entries_projectId_createdAt_idx" ON "project_log_entries"("projectId", "createdAt");
ALTER TABLE "project_log_entries" ADD CONSTRAINT "project_log_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_log_entries" ADD CONSTRAINT "project_log_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_log_entries" ADD CONSTRAINT "project_log_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_log_entry_tasks" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "entryId" TEXT NOT NULL, "taskId" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "project_log_entry_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_log_entry_tasks_entryId_taskId_key" ON "project_log_entry_tasks"("entryId", "taskId");
CREATE INDEX "project_log_entry_tasks_workspaceId_idx" ON "project_log_entry_tasks"("workspaceId");
CREATE INDEX "project_log_entry_tasks_taskId_idx" ON "project_log_entry_tasks"("taskId");
ALTER TABLE "project_log_entry_tasks" ADD CONSTRAINT "project_log_entry_tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_log_entry_tasks" ADD CONSTRAINT "project_log_entry_tasks_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "project_log_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_log_entry_tasks" ADD CONSTRAINT "project_log_entry_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_relations" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "fromProjectId" TEXT NOT NULL, "toProjectId" TEXT NOT NULL,
  "type" "ProjectRelationType" NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_relations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_relations_no_self_link" CHECK ("fromProjectId" <> "toProjectId")
);
CREATE UNIQUE INDEX "project_relations_fromProjectId_toProjectId_type_key" ON "project_relations"("fromProjectId", "toProjectId", "type");
CREATE INDEX "project_relations_workspaceId_idx" ON "project_relations"("workspaceId");
CREATE INDEX "project_relations_fromProjectId_idx" ON "project_relations"("fromProjectId");
CREATE INDEX "project_relations_toProjectId_idx" ON "project_relations"("toProjectId");
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_fromProjectId_fkey" FOREIGN KEY ("fromProjectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_toProjectId_fkey" FOREIGN KEY ("toProjectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_relations" ADD CONSTRAINT "project_relations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_log_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_log_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_log_entries_isolation ON "project_log_entries" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "project_log_entries"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "project_log_entry_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_log_entry_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_log_entry_tasks_isolation ON "project_log_entry_tasks" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "project_log_entry_tasks"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "project_relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_relations_isolation ON "project_relations" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "project_relations"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)
));
