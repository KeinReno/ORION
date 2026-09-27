-- Row Level Security for the ORION v0.12 "Документы" table — same
-- database-level defense-in-depth as notes/tasks/finance/events
-- (20260905121419_enable_rls, 20260906170419_finance_rls,
-- 20260908130100_events_calendar_rls). "documents" carries a denormalised
-- "workspaceId", so the policy is the same flat membership check everywhere.
-- FORCE because the "orion" role owns the table and table owners bypass RLS
-- by default.

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON "documents"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "documents"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
