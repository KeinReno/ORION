-- Row Level Security for the five ORION v0.8 "Финансы" tables — same
-- database-level defense-in-depth as notes/tasks (20260905121419_enable_rls),
-- backing up (not replacing) FinanceModule services' own assertMember check.
-- FORCE is required because the "orion" role owns these tables and table
-- owners bypass RLS by default.

ALTER TABLE "finance_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_accounts_isolation ON "finance_accounts"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_accounts"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "finance_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_categories_isolation ON "finance_categories"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_categories"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "finance_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_transactions_isolation ON "finance_transactions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_transactions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "finance_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_budgets_isolation ON "finance_budgets"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_budgets"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "finance_recurring_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_recurring_transactions" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_recurring_transactions_isolation ON "finance_recurring_transactions"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_recurring_transactions"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
