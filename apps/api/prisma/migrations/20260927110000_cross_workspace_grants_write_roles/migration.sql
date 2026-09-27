-- R30 (apps/api/test/r30-review.integration.test.ts, "member grantee cannot
-- retarget a grant through RLS"): the write policies from
-- `cross_workspace_grants_rls_split` admitted ANY member of the source
-- workspace. A grantee who is also an ordinary member there (restricted
-- from `notes`, say) could therefore UPDATE their own grant row straight
-- through `withUser` and point `objectId` at a note the owner never shared.
--
-- The application rules (SharedGrantsService, 27-U09-THREAT-MODEL.md §4/§5)
-- are narrower, and the DB now says the same thing:
--   INSERT — owner of the source workspace only (`create`);
--   UPDATE — owner, or the member who issued the grant (`revoke`);
--   DELETE — owner only (no API path deletes grants; restore runs asSystem).
-- On top of that, what a grant points at is immutable after creation: the
-- only legitimate UPDATE is revocation. A trigger enforces it because RLS
-- cannot compare OLD and NEW values.

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
        AND wm."role" = 'owner'
    )
  );

CREATE OR REPLACE FUNCTION cross_workspace_grants_immutable_target() RETURNS trigger AS $$
BEGIN
  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
     OR NEW."objectType" IS DISTINCT FROM OLD."objectType"
     OR NEW."objectId" IS DISTINCT FROM OLD."objectId"
     OR NEW."granteeUserId" IS DISTINCT FROM OLD."granteeUserId"
     OR NEW."granterId" IS DISTINCT FROM OLD."granterId"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."projectionFields" IS DISTINCT FROM OLD."projectionFields" THEN
    RAISE EXCEPTION 'cross_workspace_grants: grant target is immutable, revoke and issue a new grant'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cross_workspace_grants_immutable_target
  BEFORE UPDATE ON "cross_workspace_grants"
  FOR EACH ROW EXECUTE FUNCTION cross_workspace_grants_immutable_target();
