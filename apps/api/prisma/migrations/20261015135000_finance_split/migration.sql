-- Плагин «Общие расходы»: учёт между людьми («кто кому должен»), отдельно от счетов.
-- Идентификаторы пользователей — просто строки без внешних ключей: история переживает выход участника.
CREATE TABLE "finance_splits" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "paidById" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "transactionId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_splits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_splits_workspaceId_idx" ON "finance_splits"("workspaceId");
ALTER TABLE "finance_splits" ADD CONSTRAINT "finance_splits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "finance_split_shares" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "splitId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "share" INTEGER NOT NULL,
  CONSTRAINT "finance_split_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "finance_split_shares_splitId_userId_key" ON "finance_split_shares"("splitId", "userId");
CREATE INDEX "finance_split_shares_workspaceId_idx" ON "finance_split_shares"("workspaceId");
ALTER TABLE "finance_split_shares" ADD CONSTRAINT "finance_split_shares_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_split_shares" ADD CONSTRAINT "finance_split_shares_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "finance_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "finance_settlements" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_settlements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_settlements_workspaceId_idx" ON "finance_settlements"("workspaceId");
ALTER TABLE "finance_settlements" ADD CONSTRAINT "finance_settlements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: same shape as every other finance table.
ALTER TABLE "finance_splits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_splits" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_splits_isolation ON "finance_splits"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_splits"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
ALTER TABLE "finance_split_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_split_shares" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_split_shares_isolation ON "finance_split_shares"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_split_shares"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
ALTER TABLE "finance_settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_settlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_settlements_isolation ON "finance_settlements"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_settlements"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
