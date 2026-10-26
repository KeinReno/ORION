-- База знаний: разделы, материалы, источники и связи.
-- Приватный материал виден только автору (createdBy). Разделы — всему пространству.

CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'captured',
    "visibility" TEXT NOT NULL DEFAULT 'workspace',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "sourceTitle" TEXT NOT NULL DEFAULT '',
    "sourceAuthor" TEXT NOT NULL DEFAULT '',
    "originalText" TEXT NOT NULL DEFAULT '',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_relations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'related',
    CONSTRAINT "knowledge_relations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "knowledge_categories_workspaceId_idx" ON "knowledge_categories"("workspaceId");
CREATE INDEX "knowledge_items_workspaceId_idx" ON "knowledge_items"("workspaceId");
CREATE INDEX "knowledge_items_workspaceId_status_idx" ON "knowledge_items"("workspaceId", "status");
CREATE INDEX "knowledge_sources_workspaceId_idx" ON "knowledge_sources"("workspaceId");
CREATE INDEX "knowledge_sources_itemId_idx" ON "knowledge_sources"("itemId");
CREATE INDEX "knowledge_relations_workspaceId_idx" ON "knowledge_relations"("workspaceId");
CREATE INDEX "knowledge_relations_fromId_idx" ON "knowledge_relations"("fromId");
CREATE INDEX "knowledge_relations_toId_idx" ON "knowledge_relations"("toId");

ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_relations" ADD CONSTRAINT "knowledge_relations_toId_fkey" FOREIGN KEY ("toId") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_categories_isolation" ON "knowledge_categories"
  USING (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_categories"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_categories"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)));

ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_items_isolation" ON "knowledge_items"
  USING (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_items"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND ("visibility" = 'workspace' OR "createdBy" = current_setting('app.current_user_id', true))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_items"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND ("visibility" = 'workspace' OR "createdBy" = current_setting('app.current_user_id', true))
  );

ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_sources_isolation" ON "knowledge_sources"
  USING (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_sources"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_sources"."itemId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_sources"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_sources"."itemId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  );

ALTER TABLE "knowledge_relations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_relations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_relations_isolation" ON "knowledge_relations"
  USING (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_relations"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_relations"."fromId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_relations"."toId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "knowledge_relations"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_relations"."fromId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
    AND EXISTS (
      SELECT 1 FROM "knowledge_items" i
      WHERE i.id = "knowledge_relations"."toId"
        AND (i."visibility" = 'workspace' OR i."createdBy" = current_setting('app.current_user_id', true))
    )
  );
