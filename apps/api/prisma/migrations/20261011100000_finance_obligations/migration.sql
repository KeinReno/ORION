-- Obligations: debts, credits, utility bills, subscriptions (a plan; paying writes a real transaction).
CREATE TABLE "finance_obligations" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'debt',
  "direction" TEXT NOT NULL DEFAULT 'owe',
  "principal" INTEGER,
  "payment" INTEGER NOT NULL,
  "interval" TEXT NOT NULL DEFAULT 'monthly',
  "nextDueAt" TIMESTAMP(3),
  "accountId" TEXT,
  "categoryId" TEXT,
  "note" TEXT NOT NULL DEFAULT '',
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_obligations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_obligations_workspaceId_idx" ON "finance_obligations"("workspaceId");
ALTER TABLE "finance_obligations" ADD CONSTRAINT "finance_obligations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_obligations" ADD CONSTRAINT "finance_obligations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_obligations" ADD CONSTRAINT "finance_obligations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security: same shape as every other finance table.
ALTER TABLE "finance_obligations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_obligations" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_obligations_isolation ON "finance_obligations"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_obligations"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
