-- Плагин «Черновики от ИИ»: операция, предложенная агентом (прочитал чек). Не деньги: записывает только человек.
CREATE TABLE "finance_drafts" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "tokenName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "merchant" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "accountId" TEXT,
  "categoryId" TEXT,
  "confidence" DOUBLE PRECISION,
  "sourceNote" TEXT NOT NULL DEFAULT '',
  "transactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "finance_drafts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finance_drafts_workspaceId_status_idx" ON "finance_drafts"("workspaceId", "status");
ALTER TABLE "finance_drafts" ADD CONSTRAINT "finance_drafts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: same shape as every other finance table.
ALTER TABLE "finance_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_drafts_isolation ON "finance_drafts"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_drafts"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
