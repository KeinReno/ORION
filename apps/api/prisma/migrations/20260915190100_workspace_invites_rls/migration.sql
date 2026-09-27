-- Row Level Security for "workspace_invites" — same flat membership policy as
-- every other workspace-scoped table (see CLAUDE.md). Note this only lets a
-- *member* see invites for workspaces they already belong to; the app-level
-- check in WorkspaceInvitesService additionally restricts create/list/revoke
-- to owner/lead, same "RLS backs up, doesn't replace, the app-level check"
-- split used everywhere else.

ALTER TABLE "workspace_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_invites_isolation ON "workspace_invites"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "workspace_invites"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
