-- Row Level Security for the two ORION v0.13 "Финансы" tables — same
-- database-level defense-in-depth as every other finance table (see
-- finance_rls / finance_transaction_lines_and_transfers), backing up
-- (not replacing) the services' own assertMember check. FORCE is required
-- because the "orion" role owns these tables and table owners bypass RLS
-- by default.

ALTER TABLE "finance_category_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_category_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_category_rules_isolation ON "finance_category_rules"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_category_rules"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "finance_savings_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_savings_goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_savings_goals_isolation ON "finance_savings_goals"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_savings_goals"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
