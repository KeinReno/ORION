-- Плагин «Шаблоны операций»: заготовки для операций, которые повторяются без расписания.
-- Ссылки на счёт/категорию/проект — просто id без внешних ключей (шаблон переживает удаление счёта).
CREATE TABLE "finance_templates" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'expense',
  "accountId" TEXT,
  "toAccountId" TEXT,
  "categoryId" TEXT,
  "projectId" TEXT,
  "amount" INTEGER,
  "note" TEXT NOT NULL DEFAULT '',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_templates_workspaceId_idx" ON "finance_templates"("workspaceId");
ALTER TABLE "finance_templates" ADD CONSTRAINT "finance_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: same shape as every other finance table.
ALTER TABLE "finance_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_templates_isolation ON "finance_templates"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_templates"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
