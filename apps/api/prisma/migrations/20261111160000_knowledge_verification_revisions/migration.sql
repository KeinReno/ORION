-- Задание 06 (Knowledge 2.0): происхождение материала, состояние проверки,
-- история версий и настройки пространства.
-- Приватный материал виден только автору — политики версий и настроек повторяют
-- правило knowledge_items/knowledge_sources из 20261023120000_knowledge_hub.

ALTER TABLE "knowledge_items"
  ADD COLUMN "origin" JSONB,
  ADD COLUMN "verificationState" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT;

CREATE INDEX "knowledge_items_workspaceId_verificationState_idx"
  ON "knowledge_items"("workspaceId", "verificationState");
CREATE INDEX "knowledge_items_lastVerifiedAt_idx" ON "knowledge_items"("lastVerifiedAt");

-- Снимок материала. Хранит title/summary/body/origin — то, что восстанавливается.
CREATE TABLE "knowledge_item_revisions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "origin" JSONB,
    "authorId" TEXT NOT NULL,
    "restoredFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_item_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_item_revisions_workspaceId_idx" ON "knowledge_item_revisions"("workspaceId");
CREATE INDEX "knowledge_item_revisions_itemId_createdAt_idx" ON "knowledge_item_revisions"("itemId", "createdAt");

ALTER TABLE "knowledge_item_revisions" ADD CONSTRAINT "knowledge_item_revisions_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_item_revisions" ADD CONSTRAINT "knowledge_item_revisions_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Настройки базы знаний пространства: порог просроченной проверки и лимит версий.
CREATE TABLE "knowledge_settings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "verificationDays" INTEGER NOT NULL DEFAULT 90,
    "revisionLimit" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_settings_workspaceId_key" ON "knowledge_settings"("workspaceId");

ALTER TABLE "knowledge_settings" ADD CONSTRAINT "knowledge_settings_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_item_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_item_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_item_revisions_isolation" ON "knowledge_item_revisions"
  USING (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_item_revisions"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_item_revisions"."itemId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_item_revisions"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_item_revisions"."itemId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  );

ALTER TABLE "knowledge_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_settings_isolation" ON "knowledge_settings"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_settings"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_settings"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));
