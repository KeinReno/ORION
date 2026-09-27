-- Row Level Security for the v0.27 «План проекта» tables.
--
-- Both carry a denormalised `workspaceId` (milestone_dependencies too, even
-- though it could be reached through its milestone) so the policy is the
-- same flat membership check as every other workspace-owned table. The
-- structural integration test asserts ENABLE + FORCE + a policy for every
-- table with a "workspaceId", so this file is mandatory, not optional.

ALTER TABLE "milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milestones" FORCE ROW LEVEL SECURITY;
CREATE POLICY milestones_isolation ON "milestones"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "milestones"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "milestone_dependencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "milestone_dependencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY milestone_dependencies_isolation ON "milestone_dependencies"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "milestone_dependencies"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
