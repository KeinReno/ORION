-- Лимиты бюджетов получают явную валюту (см. schema.prisma Budget.currency):
-- `spent` раньше складывал строки расходов со всех счетов пространства без
-- учёта валюты, и расход в USD «съедал» рублёвый лимит (копейки RUB + центы USD).
-- Таблица уже под RLS — политики не меняются.

ALTER TABLE "finance_budgets" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RUB';

-- Заполнение: пространство, где все счета (включая архивные — по ним есть
-- история) в одной валюте (обычный случай), получает эту валюту на всех своих
-- бюджетах вместо слепого 'RUB'. Пространства с несколькими валютами остаются
-- на 'RUB': до этой миграции интерфейс показывал лимиты в ₽, так что это та же
-- валюта, которую человек видел; лимит можно пересоздать в нужной валюте.
UPDATE "finance_budgets" b
SET "currency" = single."currency"
FROM (
  SELECT "workspaceId", MIN("currency") AS "currency"
  FROM "finance_accounts"
  GROUP BY "workspaceId"
  HAVING COUNT(DISTINCT "currency") = 1
) single
WHERE single."workspaceId" = b."workspaceId";

DROP INDEX "finance_budgets_categoryId_month_key";
CREATE UNIQUE INDEX "finance_budgets_categoryId_month_currency_key" ON "finance_budgets"("categoryId", "month", "currency");
