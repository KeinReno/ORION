-- Budget limits get an explicit currency (see schema.prisma Budget.currency):
-- `spent` used to sum expense lines across every account of the workspace
-- regardless of currency, so a USD expense could "overrun" a RUB budget.

ALTER TABLE "finance_budgets" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RUB';

-- Backfill: a workspace whose accounts all share one currency (the common
-- case) gets that currency on its existing budgets instead of a blind 'RUB'.
-- Mixed-currency workspaces keep 'RUB' — the only honest guess, and the
-- limit is editable in the UI.
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
