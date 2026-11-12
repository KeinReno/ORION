-- Tasks 2.0 (задание 02): повторяющиеся задачи, массовые операции,
-- пользовательские поля/статусы и плановые свойства.
--
-- ВАЖНО: дефолтный набор статусов создаётся для КАЖДОГО существующего
-- пространства, а `tasks.statusId` бэкфилится по прежнему enum `Task.status`.
-- Существующие данные не теряются: enum-статус остаётся категорией, новый
-- пользовательский статус — отображаемое имя/цвет поверх неё.

-- --- Перечисления -----------------------------------------------------------
CREATE TYPE "TaskComplexity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "TaskExecutorSource" AS ENUM ('none', 'human', 'agent');
CREATE TYPE "TaskRecurrenceFreq" AS ENUM ('daily', 'weekly', 'monthly', 'weekdays');
CREATE TYPE "TaskRecurrenceEndMode" AS ENUM ('never', 'count', 'until');
CREATE TYPE "TaskRecurrenceInstanceStatus" AS ENUM ('scheduled', 'completed', 'skipped');
CREATE TYPE "TaskFieldType" AS ENUM ('text', 'number', 'date', 'select', 'multi', 'checkbox', 'url');
CREATE TYPE "TaskFieldApplicability" AS ENUM ('all', 'project');
CREATE TYPE "TaskStatusCategory" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- --- Пользовательские статусы (создаём до FK из tasks) ----------------------
CREATE TABLE "task_status_definitions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "TaskStatusCategory" NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'slate',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "systemKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_status_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_status_definitions_workspaceId_name_key" ON "task_status_definitions"("workspaceId", "name");
CREATE UNIQUE INDEX "task_status_definitions_workspaceId_systemKey_key" ON "task_status_definitions"("workspaceId", "systemKey");
CREATE INDEX "task_status_definitions_workspaceId_idx" ON "task_status_definitions"("workspaceId");
ALTER TABLE "task_status_definitions" ADD CONSTRAINT "task_status_definitions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Новые колонки задачи --------------------------------------------------
ALTER TABLE "tasks"
  ADD COLUMN "importance" INTEGER,
  ADD COLUMN "urgency" INTEGER,
  ADD COLUMN "complexity" "TaskComplexity",
  ADD COLUMN "statusId" TEXT,
  ADD COLUMN "executorSource" "TaskExecutorSource" NOT NULL DEFAULT 'none',
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_statusId_fkey"
  FOREIGN KEY ("statusId") REFERENCES "task_status_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tasks_statusId_idx" ON "tasks"("statusId");
CREATE INDEX "tasks_archivedAt_idx" ON "tasks"("archivedAt");

-- --- Дефолтный набор статусов для существующих пространств ------------------
INSERT INTO "task_status_definitions"
  ("id", "workspaceId", "name", "category", "color", "isDefault", "sortOrder", "systemKey", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  w."id",
  v.name,
  v.category::"TaskStatusCategory",
  v.color,
  v.is_default,
  v.sort_order,
  v.system_key,
  now(),
  now()
FROM "workspaces" w
CROSS JOIN (VALUES
  ('Бэклог', 'open', 'slate', false, 0, 'backlog'),
  ('К выполнению', 'open', 'sky', true, 10, 'todo'),
  ('В работе', 'in_progress', 'amber', false, 20, 'in_progress'),
  ('Готово', 'done', 'emerald', false, 30, 'done'),
  ('Отменено', 'cancelled', 'rose', false, 40, 'canceled')
) AS v(name, category, color, is_default, sort_order, system_key)
ON CONFLICT ("workspaceId", "systemKey") DO NOTHING;

-- Прежний enum отображается в дефолтный статус своей категории.
UPDATE "tasks" t
SET "statusId" = d."id"
FROM "task_status_definitions" d
WHERE d."workspaceId" = t."workspaceId"
  AND d."systemKey" = t."status"::text;

-- Источник исполнения: задача без исполнителя — none, с человеком — human.
UPDATE "tasks"
SET "executorSource" = CASE WHEN "assigneeId" IS NULL THEN 'none'::"TaskExecutorSource" ELSE 'human'::"TaskExecutorSource" END;

-- --- Рекуррентность --------------------------------------------------------
CREATE TABLE "task_recurrences" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "freq" "TaskRecurrenceFreq" NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "endsMode" "TaskRecurrenceEndMode" NOT NULL DEFAULT 'never',
  "endsCount" INTEGER,
  "endsAt" TIMESTAMP(3),
  "generatedCount" INTEGER NOT NULL DEFAULT 1,
  "anchorAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_recurrences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_recurrences_templateId_key" ON "task_recurrences"("templateId");
CREATE INDEX "task_recurrences_workspaceId_idx" ON "task_recurrences"("workspaceId");
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_recurrence_instances" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "recurrenceId" TEXT NOT NULL,
  "taskId" TEXT,
  "ordinal" INTEGER NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "TaskRecurrenceInstanceStatus" NOT NULL DEFAULT 'scheduled',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_recurrence_instances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_recurrence_instances_taskId_key" ON "task_recurrence_instances"("taskId");
CREATE UNIQUE INDEX "task_recurrence_instances_recurrenceId_ordinal_key" ON "task_recurrence_instances"("recurrenceId", "ordinal");
CREATE INDEX "task_recurrence_instances_workspaceId_idx" ON "task_recurrence_instances"("workspaceId");
CREATE INDEX "task_recurrence_instances_recurrenceId_status_idx" ON "task_recurrence_instances"("recurrenceId", "status");
ALTER TABLE "task_recurrence_instances" ADD CONSTRAINT "task_recurrence_instances_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_instances" ADD CONSTRAINT "task_recurrence_instances_recurrenceId_fkey"
  FOREIGN KEY ("recurrenceId") REFERENCES "task_recurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_recurrence_instances" ADD CONSTRAINT "task_recurrence_instances_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- Пользовательские поля -------------------------------------------------
CREATE TABLE "task_field_definitions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "TaskFieldType" NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "applicability" "TaskFieldApplicability" NOT NULL DEFAULT 'all',
  "projectId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_field_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_field_definitions_workspaceId_name_key" ON "task_field_definitions"("workspaceId", "name");
CREATE INDEX "task_field_definitions_workspaceId_idx" ON "task_field_definitions"("workspaceId");
CREATE INDEX "task_field_definitions_workspaceId_applicability_idx" ON "task_field_definitions"("workspaceId", "applicability");
CREATE INDEX "task_field_definitions_projectId_idx" ON "task_field_definitions"("projectId");
ALTER TABLE "task_field_definitions" ADD CONSTRAINT "task_field_definitions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_field_definitions" ADD CONSTRAINT "task_field_definitions_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_field_values" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "valueJson" JSONB,
  "valueText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_field_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_field_values_taskId_fieldId_key" ON "task_field_values"("taskId", "fieldId");
CREATE INDEX "task_field_values_workspaceId_fieldId_idx" ON "task_field_values"("workspaceId", "fieldId");
CREATE INDEX "task_field_values_workspaceId_valueText_idx" ON "task_field_values"("workspaceId", "valueText");
-- Индексация значений для поиска (2.3): полнотекстовый GIN по valueText.
CREATE INDEX "task_field_values_search_idx" ON "task_field_values"
  USING GIN (to_tsvector('russian', coalesce("valueText", '')));
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "task_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row Level Security -----------------------------------------------------
ALTER TABLE "task_status_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_status_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_status_definitions_isolation ON "task_status_definitions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_status_definitions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_recurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_recurrences" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_recurrences_isolation ON "task_recurrences"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_recurrences"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_recurrence_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_recurrence_instances" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_recurrence_instances_isolation ON "task_recurrence_instances"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_recurrence_instances"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_field_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_field_definitions_isolation ON "task_field_definitions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_field_definitions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "task_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_field_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_field_values_isolation ON "task_field_values"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "task_field_values"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
