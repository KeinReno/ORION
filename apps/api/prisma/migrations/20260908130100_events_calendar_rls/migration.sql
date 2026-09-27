-- Row Level Security for the ORION v0.10 "Календарь" tables — same
-- database-level defense-in-depth as notes/tasks/finance
-- (20260905121419_enable_rls, 20260906170419_finance_rls). All three tables
-- carry a denormalised "workspaceId", so the policy is the same flat
-- membership check everywhere. FORCE because the "orion" role owns the
-- tables and table owners bypass RLS by default.

ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
CREATE POLICY events_isolation ON "events"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "events"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "event_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY event_overrides_isolation ON "event_overrides"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "event_overrides"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "sent_reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sent_reminders" FORCE ROW LEVEL SECURITY;
CREATE POLICY sent_reminders_isolation ON "sent_reminders"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "sent_reminders"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

-- Backfill icsToken for workspaces created before this migration. gen_random_uuid()
-- twice, hex-joined, gives a 64-char unguessable token without needing pgcrypto's
-- digest(); AuthService.register mints base64url tokens for new rows.
UPDATE "workspaces"
SET "icsToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "icsToken" IS NULL;
