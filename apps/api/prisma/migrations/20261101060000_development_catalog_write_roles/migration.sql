-- Restrict catalog binding mutations to workspace owners and leads.
-- A plain member may read bindings but must not forge or rebind catalog identities.
-- Keep the SELECT policy unchanged; this migration only narrows write permissions.
DROP POLICY IF EXISTS "development_catalog_mappings_member_insert" ON "development_catalog_mappings";
DROP POLICY IF EXISTS "development_catalog_mappings_member_update" ON "development_catalog_mappings";

CREATE POLICY "development_catalog_mappings_lead_insert"
  ON "development_catalog_mappings" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
      AND wm."role" IN ('owner', 'lead')
  ));

CREATE POLICY "development_catalog_mappings_lead_update"
  ON "development_catalog_mappings" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
      AND wm."role" IN ('owner', 'lead')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
      AND wm."role" IN ('owner', 'lead')
  ));
