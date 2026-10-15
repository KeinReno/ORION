-- Плагин «Курсы валют»: курс, введённый вручную, действует с указанного дня. Внешнего источника нет намеренно.
CREATE TABLE "finance_exchange_rates" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "base" TEXT NOT NULL,
  "quote" TEXT NOT NULL,
  "rateMicro" INTEGER NOT NULL,
  "day" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_exchange_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "finance_exchange_rates_workspaceId_base_quote_day_key" ON "finance_exchange_rates"("workspaceId", "base", "quote", "day");
CREATE INDEX "finance_exchange_rates_workspaceId_idx" ON "finance_exchange_rates"("workspaceId");
ALTER TABLE "finance_exchange_rates" ADD CONSTRAINT "finance_exchange_rates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: same shape as every other finance table.
ALTER TABLE "finance_exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_exchange_rates_isolation ON "finance_exchange_rates"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_exchange_rates"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
