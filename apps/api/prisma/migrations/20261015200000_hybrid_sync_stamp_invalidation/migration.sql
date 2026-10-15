-- Hybrid sync (TZ-06 / ADR-0016): the change-feed trigger now also drops the LWW stamps of fields that were
-- changed by a write that did NOT come through sync (REST, cron, restore). Function replacement only: no table or
-- row changes. Without this a REST edit made after a sync write of the same field would not outrank the stale stamp.
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
  -- A write that did not come through sync (REST, cron, restore) invalidates the LWW stamps of the fields it changed:
  -- from now on those fields are compared by the row's updatedAt, which that write just moved. Sync's own writes set
  -- app.sync_apply and keep their stamps.
  IF TG_OP = 'UPDATE' AND COALESCE(current_setting('app.sync_apply', true), '') <> 'on' THEN
    UPDATE "sync_entity_stamps" st
       SET "stamps" = st."stamps" - COALESCE((
         SELECT array_agg(n.key)
           FROM jsonb_each(to_jsonb(NEW)) n
           JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
          WHERE n.value IS DISTINCT FROM o.value), ARRAY[]::text[])
     WHERE st."entityType" = TG_ARGV[0] AND st."entityId" = rec->>'id';
  END IF;
  RETURN NULL;
END;
$$;
