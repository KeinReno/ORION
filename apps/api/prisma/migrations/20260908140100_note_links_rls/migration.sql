-- Row Level Security for "note_links" — same flat workspace-membership
-- check as notes/tasks/finance/events (20260905121419_enable_rls,
-- 20260906170419_finance_rls, 20260908130100_events_calendar_rls). FORCE
-- because the "orion" role owns the table and owners bypass RLS by default.
--
-- The row is reachable only through a note the user can already see, but the
-- policy is still required: without it, FORCE-RLS on the parent tables would
-- not stop a raw query against "note_links" itself.

ALTER TABLE "note_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY note_links_isolation ON "note_links"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "note_links"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
