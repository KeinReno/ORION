-- R29-04 (docs/HISTORY.md) — the original
-- `cross_workspace_grants_isolation` policy from the
-- `cross_workspace_grants_rls` migration has no `FOR SELECT` clause, so it
-- applies to every command including UPDATE/DELETE. Its `OR
-- "granteeUserId" = current_setting(...)` branch was meant only to let a
-- grantee SELECT (list) grants addressed to them via `GET /shared` — but
-- with no command restriction, the same branch also lets a grantee UPDATE
-- their own grant row directly, including `objectId`, which would let them
-- redirect the grant onto a different object the owner never chose to
-- share. Application-level controllers never exposed such an endpoint, but
-- the DB-level promise of "grantee is read-only" wasn't actually true.
--
-- Fix: replace the single wide policy with four narrow ones. SELECT stays
-- open to both source-workspace members (management UI) and the grantee
-- (their own "shared with me" list). INSERT/UPDATE/DELETE are restricted to
-- source-workspace members only — the grantee gets no write policy at all,
-- so any INSERT/UPDATE/DELETE they attempt is rejected outright by RLS
-- regardless of what the row's `granteeUserId` says at the SQL level. The
-- previously-applied `cross_workspace_grants_rls` migration is left
-- untouched per the session's explicit instruction; this migration only
-- adds on top of it.

DROP POLICY IF EXISTS cross_workspace_grants_isolation ON "cross_workspace_grants";

CREATE POLICY cross_workspace_grants_select ON "cross_workspace_grants"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    OR "cross_workspace_grants"."granteeUserId" = current_setting('app.current_user_id', true)
  );

-- INSERT/UPDATE/DELETE: source-workspace members only. The grantee is
-- deliberately given no write policy of any kind — not even to touch their
-- own row — since a "grantee may revoke/ack their own grant" feature does
-- not exist in this slice; the application's revoke path is granter/owner
-- only (SharedGrantsService.revoke), which is exactly what these policies
-- now allow at the DB layer too.

CREATE POLICY cross_workspace_grants_insert ON "cross_workspace_grants"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY cross_workspace_grants_update ON "cross_workspace_grants"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY cross_workspace_grants_delete ON "cross_workspace_grants"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "cross_workspace_grants"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  );
