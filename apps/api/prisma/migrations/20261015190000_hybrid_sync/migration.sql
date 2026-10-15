-- Hybrid sync (TZ-06 / ADR-0015): sync mode per workspace, change feed written by triggers, op ledger,
-- field stamps, device registry. Additive: no existing column or row changes meaning.
ALTER TABLE "workspaces" ADD COLUMN "syncMode" TEXT NOT NULL DEFAULT 'shared';

CREATE TABLE "sync_changes" (
    "id" BIGSERIAL NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_changes_workspaceId_xid_id_idx" ON "sync_changes"("workspaceId", "xid", "id");
CREATE INDEX "sync_changes_entityType_entityId_idx" ON "sync_changes"("entityType", "entityId");
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_ops" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceSeq" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_ops_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sync_ops_workspaceId_opId_key" ON "sync_ops"("workspaceId", "opId");
CREATE UNIQUE INDEX "sync_ops_deviceId_deviceSeq_key" ON "sync_ops"("deviceId", "deviceSeq");
CREATE INDEX "sync_ops_workspaceId_createdAt_idx" ON "sync_ops"("workspaceId", "createdAt");
ALTER TABLE "sync_ops" ADD CONSTRAINT "sync_ops_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_entity_stamps" (
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stamps" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sync_entity_stamps_pkey" PRIMARY KEY ("entityType", "entityId")
);
CREATE INDEX "sync_entity_stamps_workspaceId_idx" ON "sync_entity_stamps"("workspaceId");
ALTER TABLE "sync_entity_stamps" ADD CONSTRAINT "sync_entity_stamps_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "sync_devices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_devices_userId_idx" ON "sync_devices"("userId");
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: membership for workspace tables, ownership for devices.
ALTER TABLE "sync_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_changes_isolation ON "sync_changes"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "sync_changes"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)));
ALTER TABLE "sync_ops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_ops" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_ops_isolation ON "sync_ops"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "sync_ops"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)));
ALTER TABLE "sync_entity_stamps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_entity_stamps" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_entity_stamps_isolation ON "sync_entity_stamps"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "sync_entity_stamps"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)));
ALTER TABLE "sync_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_devices_isolation ON "sync_devices"
  USING ("userId" = current_setting('app.current_user_id', true));

-- Change feed trigger. SECURITY DEFINER (owner = migration role, BYPASSRLS): the writer may be a plain member,
-- orion_system or a cron, and none of them may insert into the feed directly. It skips a workspace that is being
-- deleted (cascade) so the foreign key never fires.
CREATE OR REPLACE FUNCTION "sync_log_change"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec jsonb;
  ws text;
  parent text;
  change_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := to_jsonb(OLD);
    change_kind := 'delete';
  ELSE
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
      RETURN NULL;
    END IF;
    rec := to_jsonb(NEW);
    change_kind := 'upsert';
  END IF;
  ws := rec->>'workspaceId';
  IF TG_ARGV[1] <> '' THEN
    parent := rec->>TG_ARGV[1];
  END IF;
  IF EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = ws) THEN
    INSERT INTO "sync_changes" ("workspaceId", "entityType", "entityId", "parentId", "kind")
    VALUES (ws, TG_ARGV[0], rec->>'id', parent, change_kind);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "lists_sync_log" AFTER INSERT OR UPDATE OR DELETE ON "lists"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_change"('list', '');
CREATE TRIGGER "list_items_sync_log" AFTER INSERT OR UPDATE OR DELETE ON "list_items"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_change"('listItem', 'listId');
CREATE TRIGGER "notes_sync_log" AFTER INSERT OR UPDATE OR DELETE ON "notes"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_change"('note', '');
CREATE TRIGGER "tasks_sync_log" AFTER INSERT OR UPDATE OR DELETE ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "sync_log_change"('task', '');
