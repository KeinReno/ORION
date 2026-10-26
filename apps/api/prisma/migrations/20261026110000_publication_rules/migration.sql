CREATE TABLE publication_rules (
  id TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "targetWorkspaceId" TEXT NOT NULL,
  config JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 1,
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  history JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "publication_rules_workspaceId_enabled_idx" ON publication_rules("workspaceId", enabled);
CREATE INDEX "publication_rules_targetWorkspaceId_idx" ON publication_rules("targetWorkspaceId");
ALTER TABLE publication_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE publication_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY publication_rules_owner ON publication_rules USING (
  "userId" = current_setting('app.current_user_id', true) AND EXISTS (
    SELECT 1 FROM workspace_members m WHERE m."workspaceId" = publication_rules."workspaceId"
      AND m."userId" = current_setting('app.current_user_id', true) AND m.role = 'owner'
  )
) WITH CHECK (
  "userId" = current_setting('app.current_user_id', true) AND EXISTS (
    SELECT 1 FROM workspace_members m WHERE m."workspaceId" = publication_rules."workspaceId"
      AND m."userId" = current_setting('app.current_user_id', true) AND m.role = 'owner'
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON publication_rules TO orion_app, orion_system;
ALTER TABLE shared_publications ADD COLUMN "ruleId" TEXT;
CREATE UNIQUE INDEX "shared_publications_ruleId_sourceId_key" ON shared_publications("ruleId", "sourceId");

-- Restore of either side must not re-enable old automation, including rules in
-- another source workspace invisible to the restoring target owner.
CREATE OR REPLACE FUNCTION public.revoke_publications_from_source(source_workspace_id TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members m
    WHERE m."workspaceId" = source_workspace_id AND m."userId" = current_setting('app.current_user_id', true) AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Source workspace owner required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.publication_rules SET enabled = false, revision = revision + 1,
    "lastError" = 'После восстановления требуется новый предпросмотр и подтверждение', "updatedAt" = now()
    WHERE "workspaceId" = source_workspace_id OR "targetWorkspaceId" = source_workspace_id;
  UPDATE public.shared_publications SET "revokedAt" = now(), revision = revision + 1, "updatedAt" = now()
    WHERE ("sourceWorkspaceId" = source_workspace_id OR "workspaceId" = source_workspace_id) AND "revokedAt" IS NULL;
END;
$$;
ALTER FUNCTION public.revoke_publications_from_source(TEXT) OWNER TO orion_system;
REVOKE ALL ON FUNCTION public.revoke_publications_from_source(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_publications_from_source(TEXT) TO orion_app, orion_system;
