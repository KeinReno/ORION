-- Row Level Security: database-level defense-in-depth for workspace
-- isolation, backing up (not replacing) the application-level check in
-- WorkspacesService.assertMember. FORCE is required because the "orion"
-- role owns these tables and table owners bypass RLS by default.
--
-- users is intentionally excluded: login/register must look up any user
-- by email before an identity (and therefore a workspace context) exists.

ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_members_isolation ON "workspace_members"
  USING ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_isolation ON "workspaces"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "workspaces"."id"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY notes_isolation ON "notes"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "notes"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_isolation ON "tasks"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "tasks"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
