-- 11: Git Workspace, привязки коммитов к задачам и раскладка Architect.
-- Только чтение репозиториев: путь хранится как конфигурация пространства и проверяется сервером
-- на принадлежность ORION_DEV_REPOSITORY_ROOTS при каждом чтении; каталог на диске эти таблицы не трогают.

CREATE TABLE "development_git_repositories" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "taskRefPrefix" TEXT NOT NULL DEFAULT '#',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "development_git_repositories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "development_git_repositories_workspaceId_path_key"
  ON "development_git_repositories"("workspaceId", "path");
CREATE INDEX "development_git_repositories_workspaceId_idx" ON "development_git_repositories"("workspaceId");
ALTER TABLE "development_git_repositories" ADD CONSTRAINT "development_git_repositories_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_commit_links" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "sha" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "committedAt" TIMESTAMP(3),
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_commit_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_commit_links_taskId_repositoryId_sha_key"
  ON "task_commit_links"("taskId", "repositoryId", "sha");
CREATE INDEX "task_commit_links_workspaceId_idx" ON "task_commit_links"("workspaceId");
CREATE INDEX "task_commit_links_repositoryId_sha_idx" ON "task_commit_links"("repositoryId", "sha");
ALTER TABLE "task_commit_links" ADD CONSTRAINT "task_commit_links_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_commit_links" ADD CONSTRAINT "task_commit_links_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_commit_links" ADD CONSTRAINT "task_commit_links_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "development_git_repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "development_architect_layouts" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "nodes" JSONB NOT NULL DEFAULT '[]',
  "viewport" JSONB NOT NULL DEFAULT '{}',
  "projectSchema" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "development_architect_layouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "development_architect_layouts_workspaceId_repositoryId_key"
  ON "development_architect_layouts"("workspaceId", "repositoryId");
CREATE INDEX "development_architect_layouts_workspaceId_idx" ON "development_architect_layouts"("workspaceId");
ALTER TABLE "development_architect_layouts" ADD CONSTRAINT "development_architect_layouts_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "development_architect_layouts" ADD CONSTRAINT "development_architect_layouts_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "development_git_repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: та же политика членства, что у остальных workspace-таблиц.
ALTER TABLE "development_git_repositories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_git_repositories" FORCE ROW LEVEL SECURITY;
CREATE POLICY development_git_repositories_isolation ON "development_git_repositories"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_git_repositories"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_commit_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_commit_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_commit_links_isolation ON "task_commit_links"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_commit_links"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "development_architect_layouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_architect_layouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY development_architect_layouts_isolation ON "development_architect_layouts"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_architect_layouts"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
