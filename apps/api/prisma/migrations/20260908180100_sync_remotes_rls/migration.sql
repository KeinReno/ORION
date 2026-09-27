-- Row Level Security для таблицы "sync_remotes" — та же защита на уровне БД,
-- что у notes/tasks/finance/events/documents (20260905121419_enable_rls,
-- 20260906170419_finance_rls, 20260908130100_events_calendar_rls,
-- 20260908160200_documents_rls). "sync_remotes" несёт "workspaceId", поэтому
-- политика — тот же плоский membership-check. FORCE, потому что таблицей
-- владеет роль "orion", а владелец таблицы по умолчанию обходит RLS.

ALTER TABLE "sync_remotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_remotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_remotes_isolation ON "sync_remotes"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "sync_remotes"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
