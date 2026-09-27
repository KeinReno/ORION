-- Every new workspace-owned table gets the same membership-based RLS guard.

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_isolation ON "projects" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "projects"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_dependencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_dependencies_isolation ON "task_dependencies" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "task_dependencies"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "saved_task_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_task_views" FORCE ROW LEVEL SECURITY;
CREATE POLICY saved_task_views_isolation ON "saved_task_views" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "saved_task_views"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "calendar_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_connections_isolation ON "calendar_connections" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "calendar_connections"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY document_versions_isolation ON "document_versions" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "document_versions"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "document_annotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_annotations" FORCE ROW LEVEL SECURITY;
CREATE POLICY document_annotations_isolation ON "document_annotations" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "document_annotations"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "note_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY note_attachments_isolation ON "note_attachments" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "note_attachments"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "inbox_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_items_isolation ON "inbox_items" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "inbox_items"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_isolation ON "notifications" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "notifications"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "entity_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY entity_links_isolation ON "entity_links" USING (EXISTS (
  SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "entity_links"."workspaceId"
    AND wm."userId" = current_setting('app.current_user_id', true)
));

-- Search indexes used by the global command center and document search.
CREATE INDEX documents_search_idx ON "documents" USING GIN (
  to_tsvector('russian', "name" || ' ' || "extractedText")
);
CREATE INDEX projects_search_idx ON "projects" USING GIN (
  to_tsvector('russian', "name" || ' ' || "description")
);
