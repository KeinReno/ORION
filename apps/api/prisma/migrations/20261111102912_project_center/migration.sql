-- ЗАДАНИЕ 03 «Центр проектов». Миграция намеренно ограничена этим заданием: файл schema.prisma общий
-- для параллельных заданий, поэтому диф Prisma мог захватить чужие правки — здесь только иерархия
-- проектов, шаблоны и история изменений.

-- 1. Иерархия: дочерний проект — обычный Project со своим workspace/видимостью.
ALTER TABLE "projects" ADD COLUMN "parentId" TEXT;
ALTER TABLE "projects" ADD CONSTRAINT "projects_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Ancestor/потомки читаются recursive CTE по parentId; индекс нужен и выборке детей, и проверке циклов.
CREATE INDEX "projects_workspaceId_parentId_idx" ON "projects"("workspaceId", "parentId");

-- 2. Шаблоны: отдельная таблица (шаблон — не проект), структура — одно JSON-дерево со сдвигами в днях.
CREATE TABLE "project_templates" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "structure" JSONB NOT NULL,
  "createdById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_templates_workspaceId_name_key" ON "project_templates"("workspaceId", "name");
CREATE INDEX "project_templates_workspaceId_idx" ON "project_templates"("workspaceId");
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. История изменений: append-only, пишется в транзакции самого изменения.
CREATE TABLE "project_history_entries" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "actorId" TEXT,
  "field" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "eventId" TEXT,
  "logEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_history_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_history_entries_workspaceId_idx" ON "project_history_entries"("workspaceId");
CREATE INDEX "project_history_entries_projectId_createdAt_idx" ON "project_history_entries"("projectId", "createdAt");
CREATE INDEX "project_history_entries_projectId_field_createdAt_idx" ON "project_history_entries"("projectId", "field", "createdAt");
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Запись журнала удалили — история остаётся, снимается только ссылка на «решение».
ALTER TABLE "project_history_entries" ADD CONSTRAINT "project_history_entries_logEntryId_fkey"
  FOREIGN KEY ("logEntryId") REFERENCES "project_log_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. RLS: обе новые таблицы — workspace-scoped, как остальные. ENABLE + FORCE + политика по членству.
ALTER TABLE "project_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_templates_isolation ON "project_templates" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "project_templates"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)
));
ALTER TABLE "project_history_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_history_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY project_history_entries_isolation ON "project_history_entries" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "project_history_entries"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)
));
