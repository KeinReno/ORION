-- Row Level Security for "time_entries" (v0.18 «Учёт времени»).
--
-- Same membership-based policy as every other workspace-owned table, in its own
-- migration to match the project's convention (table migration, then RLS
-- migration — see events_calendar_core/events_calendar_rls). The structural
-- integration test asserts ENABLE + FORCE + at least one policy for every table
-- carrying a "workspaceId", so a new table without this file fails the suite.

ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY time_entries_isolation ON "time_entries"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "time_entries"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
