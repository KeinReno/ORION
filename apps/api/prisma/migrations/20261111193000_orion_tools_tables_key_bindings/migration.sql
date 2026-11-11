-- Задание 10 (Orion Tools): пользовательские таблицы и личные горячие клавиши.
--
-- Все три таблицы workspace-scoped, поэтому по правилу репозитория они получают
-- ENABLE + FORCE ROW LEVEL SECURITY и политику по membership, а не только проверку
-- в сервисе. `table_rows.workspaceId` денормализован осознанно: RLS-политика не
-- должна зависеть от join к определению таблицы, а принадлежность строки и
-- определения одному пространству проверяет сервис в той же транзакции.

CREATE TABLE "table_definitions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "columns" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "table_rows" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "values" JSONB NOT NULL DEFAULT '{}',
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "table_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "key_bindings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "keys" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'global',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "key_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "table_definitions_workspaceId_idx" ON "table_definitions"("workspaceId");
CREATE INDEX "table_definitions_workspaceId_updatedAt_idx" ON "table_definitions"("workspaceId", "updatedAt");
CREATE INDEX "table_rows_workspaceId_idx" ON "table_rows"("workspaceId");
CREATE INDEX "table_rows_tableId_position_idx" ON "table_rows"("tableId", "position");
CREATE UNIQUE INDEX "key_bindings_workspaceId_userId_commandId_key" ON "key_bindings"("workspaceId", "userId", "commandId");
CREATE INDEX "key_bindings_workspaceId_userId_idx" ON "key_bindings"("workspaceId", "userId");

ALTER TABLE "table_definitions" ADD CONSTRAINT "table_definitions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_rows" ADD CONSTRAINT "table_rows_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "table_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "key_bindings" ADD CONSTRAINT "key_bindings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (та же политика членства, что у остальных workspace-таблиц).
ALTER TABLE "table_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY table_definitions_isolation ON "table_definitions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "table_definitions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "table_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_rows" FORCE ROW LEVEL SECURITY;
CREATE POLICY table_rows_isolation ON "table_rows"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "table_rows"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "key_bindings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "key_bindings" FORCE ROW LEVEL SECURITY;
CREATE POLICY key_bindings_isolation ON "key_bindings"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "key_bindings"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
