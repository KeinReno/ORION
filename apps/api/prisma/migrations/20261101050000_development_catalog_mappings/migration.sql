-- ORION DEV: durable external catalog-to-entity bindings.
-- Run as migration owner; application queries must use PrismaService.withUser.
CREATE TABLE "development_catalog_mappings" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "catalogId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "development_catalog_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "development_catalog_mappings_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "development_catalog_mappings_kind_check"
    CHECK ("kind" IN ('project', 'task'))
);
CREATE UNIQUE INDEX "development_catalog_mappings_workspaceId_catalogId_kind_externalId_key"
  ON "development_catalog_mappings"("workspaceId", "catalogId", "kind", "externalId");
CREATE UNIQUE INDEX "development_catalog_mappings_workspaceId_catalogId_kind_entityId_key"
  ON "development_catalog_mappings"("workspaceId", "catalogId", "kind", "entityId");
CREATE INDEX "development_catalog_mappings_workspaceId_catalogId_idx"
  ON "development_catalog_mappings"("workspaceId", "catalogId");

-- Fail closed when app.current_user_id is unset; membership is scoped to this workspace.
ALTER TABLE "development_catalog_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_catalog_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "development_catalog_mappings_member_select"
  ON "development_catalog_mappings" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));
CREATE POLICY "development_catalog_mappings_member_insert"
  ON "development_catalog_mappings" FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));
CREATE POLICY "development_catalog_mappings_member_update"
  ON "development_catalog_mappings" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_catalog_mappings"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));
-- No DELETE policy: mapping deletion must be a separate, audited administrative workflow.
GRANT SELECT, INSERT, UPDATE ON "development_catalog_mappings" TO orion_app, orion_system;
