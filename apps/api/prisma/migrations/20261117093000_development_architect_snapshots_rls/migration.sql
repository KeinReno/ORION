-- The snapshot table was added after the original Architect migration and
-- must use the same membership boundary as the other workspace-owned tables.
ALTER TABLE "development_architect_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_architect_snapshots" FORCE ROW LEVEL SECURITY;

CREATE POLICY development_architect_snapshots_isolation
  ON "development_architect_snapshots"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_architect_snapshots"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_architect_snapshots"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));

GRANT SELECT, INSERT, UPDATE ON "development_architect_snapshots" TO orion_app, orion_system;
