-- «Списки»: виды и шаблоны списков, ручной порядок, количество/единица/заметка/срок/секция/цена
-- пункта, кто и когда отметил, связь пункта с расходом (плагин «Покупки → Финансы»).
-- Таблицы уже под RLS (lists_rls) — новые колонки политики не меняют.

ALTER TABLE "lists"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "list_items"
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "note" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "dueAt" TIMESTAMP(3),
  ADD COLUMN "section" TEXT,
  ADD COLUMN "priceMinor" INTEGER,
  ADD COLUMN "checkedAt" TIMESTAMP(3),
  ADD COLUMN "checkedById" TEXT,
  ADD COLUMN "expenseTransactionId" TEXT;

-- Порядок, который пользователь видел до миграции (по времени создания), становится ручным порядком.
UPDATE "lists" l SET "sortOrder" = r.rn
FROM (SELECT id, (ROW_NUMBER() OVER (PARTITION BY "workspaceId" ORDER BY "createdAt", id)) * 10 AS rn FROM "lists") r
WHERE l.id = r.id;

UPDATE "list_items" i SET "sortOrder" = r.rn
FROM (SELECT id, (ROW_NUMBER() OVER (PARTITION BY "listId" ORDER BY "createdAt", id)) * 10 AS rn FROM "list_items") r
WHERE i.id = r.id;

-- Уже отмеченные пункты получают время отметки = последнее изменение (автора не знаем — остаётся NULL).
UPDATE "list_items" SET "checkedAt" = "updatedAt" WHERE "checked" = true;

CREATE INDEX "list_items_checkedById_idx" ON "list_items"("checkedById");
CREATE INDEX "list_items_expenseTransactionId_idx" ON "list_items"("expenseTransactionId");

ALTER TABLE "list_items"
  ADD CONSTRAINT "list_items_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "list_items_expenseTransactionId_fkey" FOREIGN KEY ("expenseTransactionId") REFERENCES "finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
