-- Row Level Security для "sync_restore_operations" — тот же плоский
-- membership-check, что у sync_remotes (20260908180100_sync_remotes_rls).
-- FORCE, потому что таблицей владеет роль "orion" (миграции), а владелец
-- таблицы по умолчанию обходит RLS.

ALTER TABLE "sync_restore_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_restore_operations" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_restore_operations_isolation ON "sync_restore_operations"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "sync_restore_operations"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
