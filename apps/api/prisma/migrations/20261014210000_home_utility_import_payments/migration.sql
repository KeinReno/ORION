ALTER TABLE "home_utility_months"
  ADD COLUMN "importedUtilityMinor" INTEGER,
  ADD COLUMN "importedGrandTotalMinor" INTEGER;

CREATE UNIQUE INDEX "finance_transactions_id_workspaceId_key"
  ON "finance_transactions"("id", "workspaceId");
CREATE UNIQUE INDEX "home_utility_months_id_workspaceId_key"
  ON "home_utility_months"("id", "workspaceId");

CREATE TABLE "home_utility_payments" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "monthId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "home_utility_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "home_utility_payments_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "home_utility_payments_monthId_transactionId_key"
  ON "home_utility_payments"("monthId", "transactionId");
CREATE INDEX "home_utility_payments_workspaceId_monthId_idx"
  ON "home_utility_payments"("workspaceId", "monthId");
CREATE INDEX "home_utility_payments_workspaceId_transactionId_idx"
  ON "home_utility_payments"("workspaceId", "transactionId");

ALTER TABLE "home_utility_payments"
  ADD CONSTRAINT "home_utility_payments_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "home_utility_payments_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "home_utility_payments_monthId_workspaceId_fkey"
  FOREIGN KEY ("monthId", "workspaceId") REFERENCES "home_utility_months"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "home_utility_payments_transactionId_workspaceId_fkey"
  FOREIGN KEY ("transactionId", "workspaceId") REFERENCES "finance_transactions"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "home_utility_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "home_utility_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY home_utility_payments_isolation ON "home_utility_payments"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "home_utility_payments"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)));
