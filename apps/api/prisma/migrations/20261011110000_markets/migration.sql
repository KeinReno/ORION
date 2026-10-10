-- Module «Рынки»: watchlist + imported journal. The module is OFF by default: existing workspaces get it added to
-- disabledModules, and so do new ones (column default), so nothing appears until a workspace turns it on.
ALTER TABLE "workspaces" ALTER COLUMN "disabledModules" SET DEFAULT ARRAY['markets']::TEXT[];
UPDATE "workspaces" SET "disabledModules" = array_append("disabledModules", 'markets') WHERE NOT ('markets' = ANY("disabledModules"));

CREATE TABLE "market_watch_items" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "market_watch_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "market_watch_items_workspaceId_market_symbol_key" ON "market_watch_items"("workspaceId", "market", "symbol");
CREATE INDEX "market_watch_items_workspaceId_idx" ON "market_watch_items"("workspaceId");
ALTER TABLE "market_watch_items" ADD CONSTRAINT "market_watch_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "investment_trades" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "externalUid" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'compass',
  "mode" TEXT NOT NULL DEFAULT 'real',
  "market" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tradedAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "feeTransactionId" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "investment_trades_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "investment_trades_workspaceId_externalUid_key" ON "investment_trades"("workspaceId", "externalUid");
CREATE INDEX "investment_trades_workspaceId_tradedAt_idx" ON "investment_trades"("workspaceId", "tradedAt");
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "investment_trades" ADD CONSTRAINT "investment_trades_feeTransactionId_fkey" FOREIGN KEY ("feeTransactionId") REFERENCES "finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "market_watch_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "market_watch_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY market_watch_items_isolation ON "market_watch_items"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "market_watch_items"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "investment_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "investment_trades" FORCE ROW LEVEL SECURITY;
CREATE POLICY investment_trades_isolation ON "investment_trades"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "investment_trades"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
