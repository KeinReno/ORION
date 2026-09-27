-- Row Level Security for the v0.19 «Привычки» tables.
--
-- Both carry a denormalised `workspaceId` (HabitEntry too, even though it could
-- be reached through its habit) so the policy is the same flat membership check
-- as every other workspace-owned table, and `habit_entries` is protected even
-- when queried directly. The structural integration test asserts ENABLE +
-- FORCE + a policy for every table with a "workspaceId", so this file is
-- mandatory, not optional.

ALTER TABLE "habits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habits" FORCE ROW LEVEL SECURITY;
CREATE POLICY habits_isolation ON "habits"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "habits"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "habit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "habit_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY habit_entries_isolation ON "habit_entries"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "habit_entries"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
