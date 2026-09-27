-- Widens "workspace_members_isolation" from "see only your own row" to "see
-- every membership row of a workspace you belong to" — the same intent as
-- every other table's flat membership-join policy, but a naive
-- self-referencing EXISTS (workspace_members querying workspace_members)
-- makes Postgres reject the policy outright:
--   ERROR: infinite recursion detected in policy for relation "workspace_members"
-- (confirmed locally — this is not the same shape as "workspaces_isolation",
-- which subqueries a *different* table and works fine). The documented
-- workaround is a SECURITY DEFINER helper: it runs as its owner ("orion",
-- BYPASSRLS), so the lookup inside it is not itself subject to this table's
-- RLS policy, breaking the recursion.
--
-- Behaviour change: any member can now list who else is in their workspace
-- (GET /workspaces/:id/members) — required for the invite flow (who's
-- pending/already in) and for assigning tasks to a teammate.

CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace_id TEXT, p_user_id TEXT)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "workspace_members"
    WHERE "workspaceId" = p_workspace_id AND "userId" = p_user_id
  );
$$;

ALTER FUNCTION is_workspace_member(TEXT, TEXT) OWNER TO orion;

DROP POLICY "workspace_members_isolation" ON "workspace_members";
CREATE POLICY workspace_members_isolation ON "workspace_members"
  USING (is_workspace_member("workspaceId", current_setting('app.current_user_id', true)));
