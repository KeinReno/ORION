-- Простой режим финансов («только доходы и расходы»): настройки пространства
-- (режим simple/advanced) и флаг isDefault на счетах — счёт «Основной», на
-- который простой режим записывает операции без выбранного счёта. Расширенный
-- режим не меняется: accountId по-прежнему обязателен, когда mode = advanced.

CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'advanced',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "finance_settings_workspaceId_key" ON "finance_settings"("workspaceId");

ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finance_accounts" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Не более одного счёта-умолчания на пространство. Частичный индекс — единственное
-- место, где Prisma-схема его не выражает (partial index недоступен), поэтому он
-- создаётся здесь, руками. Индекс же ловит гонку двух одновременных ленивых
-- созданий счёта: проигравший получит P2002 и перечитает строку победителя.
CREATE UNIQUE INDEX "finance_accounts_one_default" ON "finance_accounts"("workspaceId") WHERE "isDefault" = true;

ALTER TABLE "finance_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "finance_settings_isolation" ON "finance_settings"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "finance_settings"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "finance_settings"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

-- Явный GRANT: ALTER DEFAULT PRIVILEGES действует только на базу, созданную
-- init-скриптом; на чистой базе (CI, новый узел) прав на новую таблицу не было бы.
GRANT SELECT, INSERT, UPDATE, DELETE ON "finance_settings" TO orion_app, orion_system;
