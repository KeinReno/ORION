-- R30: write policies of cross_workspace_grants must match the service rules.
--
-- The R29-04 split (20260922200000) removed the grantee's write access but
-- granted INSERT/UPDATE/DELETE to *any* member of the source workspace. The
-- service is stricter: only the `owner` may CREATE a grant
-- (SharedGrantsService.create), and only the original granter (while still a
-- member) or the owner may REVOKE it (SharedGrantsService.revoke). So a plain
-- `member` — who may also be the grantee, e.g. a member the owner shared a
-- note with — could retarget `objectId` of a grant row at the SQL level and
-- point it at an object the owner never chose to share
-- (r30-review.integration.test: "member grantee cannot retarget a grant
-- through RLS"). The DB layer is meant to hold even if application code is
-- bypassed, so the policies now say exactly what the service says.
--
-- Roles are read from workspace_members.role; `granterId` is a
-- WorkspaceMember.id (see the schema comment), hence the join on wm."id".

DROP POLICY IF EXISTS cross_workspace_grants_insert ON "cross_workspace_grants";
DROP POLICY IF EXISTS cross_workspace_grants_update ON "cross_workspace_grants";
DROP POLICY IF EXISTS cross_workspace_grants_delete ON "cross_workspace_grants";

CREATE POLICY cross_workspace_grants_insert ON "cross_workspace_grants"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
        AND wm."role" = 'owner'
    )
  );

CREATE POLICY cross_workspace_grants_update ON "cross_workspace_grants"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
        AND (wm."role" = 'owner' OR wm."id" = "cross_workspace_grants"."granterId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
        AND (wm."role" = 'owner' OR wm."id" = "cross_workspace_grants"."granterId")
    )
  );

CREATE POLICY cross_workspace_grants_delete ON "cross_workspace_grants"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
        AND (wm."role" = 'owner' OR wm."id" = "cross_workspace_grants"."granterId")
    )
  );
