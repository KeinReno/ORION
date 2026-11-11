-- Задание 04 «Планирование»: собственные таблицы планирования и поля паузы/правок учёта времени.
--
-- Только то, чего нет ни в одной существующей таблице: тайм-блоки, пресеты осей
-- матрицы и недельный план времени. Задачи, проекты, вехи, события и записи
-- времени — существующие сущности; планирование их читает через публичные
-- контракты владельцев, поэтому новых копий нет.

CREATE TABLE "planning_blocks" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT,
  "projectId" TEXT,
  "title" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "type" TEXT NOT NULL DEFAULT 'focus',
  "state" TEXT NOT NULL DEFAULT 'draft',
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "clientMutationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "planning_blocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "planning_blocks_workspaceId_clientMutationId_key" ON "planning_blocks"("workspaceId", "clientMutationId");
CREATE INDEX "planning_blocks_workspaceId_idx" ON "planning_blocks"("workspaceId");
CREATE INDEX "planning_blocks_workspaceId_startAt_idx" ON "planning_blocks"("workspaceId", "startAt");
CREATE INDEX "planning_blocks_taskId_idx" ON "planning_blocks"("taskId");
CREATE INDEX "planning_blocks_projectId_idx" ON "planning_blocks"("projectId");
ALTER TABLE "planning_blocks" ADD CONSTRAINT "planning_blocks_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "planning_matrix_presets" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "xAxis" JSONB NOT NULL,
  "yAxis" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "planning_matrix_presets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "planning_matrix_presets_workspaceId_name_key" ON "planning_matrix_presets"("workspaceId", "name");
CREATE INDEX "planning_matrix_presets_workspaceId_idx" ON "planning_matrix_presets"("workspaceId");
ALTER TABLE "planning_matrix_presets" ADD CONSTRAINT "planning_matrix_presets_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "time_plans" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "week" TEXT NOT NULL,
  "plannedMinutes" INTEGER NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "time_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "time_plans_workspaceId_week_key" ON "time_plans"("workspaceId", "week");
CREATE INDEX "time_plans_workspaceId_idx" ON "time_plans"("workspaceId");
ALTER TABLE "time_plans" ADD CONSTRAINT "time_plans_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Учёт времени (задание 04): пауза и ручная корректировка. Длительность
-- по-прежнему не хранится — её считает `entryMinutes()` (startedAt/endedAt минус
-- накопленная пауза), поэтому старые строки остаются корректными без бэкфилла.
ALTER TABLE "time_entries" ADD COLUMN "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "edits" JSONB NOT NULL DEFAULT '[]';

-- Row Level Security: те же плоские политики по членству, что у остальных
-- workspace-таблиц. Без них новая таблица была бы невидима orion_app после FORCE
-- или, хуже, видна всем.
ALTER TABLE "planning_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planning_blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY planning_blocks_isolation ON "planning_blocks"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "planning_blocks"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "planning_matrix_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planning_matrix_presets" FORCE ROW LEVEL SECURITY;
CREATE POLICY planning_matrix_presets_isolation ON "planning_matrix_presets"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "planning_matrix_presets"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "time_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY time_plans_isolation ON "time_plans"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "time_plans"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
