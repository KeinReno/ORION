-- Row Level Security for "finance_transaction_lines".
--
-- This is the one workspace-owned table that shipped without a policy: v0.11
-- (20260907222336_finance_transaction_lines_and_transfers) created it with a
-- denormalised "workspaceId" precisely so it could carry the same flat
-- membership policy as the rest of finance — and then never added one. The
-- comment in 20260908190728_finance_tags_rules_goals_rls even cites that
-- migration as the RLS example for the module, so the safeguard was
-- documented without existing. The table is always reached through
-- "finance_transactions" in practice, which does have RLS, so this was
-- defence-in-depth rather than an open door — but it is exactly the kind of
-- gap the second safeguard exists for.
--
-- Same membership-based policy as every other finance table. FORCE is
-- required because the "orion" role owns these tables and table owners
-- bypass RLS by default (see infra/postgres/init/01-app-roles.sql).

ALTER TABLE "finance_transaction_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_transaction_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY finance_transaction_lines_isolation ON "finance_transaction_lines"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_transaction_lines"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
