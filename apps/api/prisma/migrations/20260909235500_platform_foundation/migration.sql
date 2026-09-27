-- ORION platform foundation: preferences, projects, inbox, notification center,
-- cross-entity links and deeper task/calendar/finance/document metadata.

ALTER TABLE "documents" ADD COLUMN "extractedText" TEXT NOT NULL DEFAULT '', ADD COLUMN "projectId" TEXT;
ALTER TABLE "events" ADD COLUMN "calendarConnectionId" TEXT, ADD COLUMN "externalUid" TEXT,
  ADD COLUMN "projectId" TEXT, ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "finance_accounts" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RUB';
ALTER TABLE "finance_transactions" ADD COLUMN "importedRef" TEXT, ADD COLUMN "projectId" TEXT,
  ADD COLUMN "reconciledAt" TIMESTAMP(3);
ALTER TABLE "notes" ADD COLUMN "projectId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "deviceName" TEXT, ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "userAgent" TEXT;
ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "parentId" TEXT,
  ADD COLUMN "projectId" TEXT, ADD COLUMN "recurrence" JSONB, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "passwordStrength" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "user_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "theme" TEXT NOT NULL DEFAULT 'system',
  "accent" TEXT NOT NULL DEFAULT 'violet',
  "density" TEXT NOT NULL DEFAULT 'comfortable',
  "timeZone" TEXT,
  "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
  "desktopNotifications" BOOLEAN NOT NULL DEFAULT true,
  "taskReminders" BOOLEAN NOT NULL DEFAULT true,
  "eventReminders" BOOLEAN NOT NULL DEFAULT true,
  "financeAlerts" BOOLEAN NOT NULL DEFAULT true,
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "dashboardWidgets" TEXT[] DEFAULT ARRAY['focus', 'calendar', 'tasks', 'finance', 'notes', 'projects']::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "color" TEXT,
  "startAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "budgetAmount" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_dependencies" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "taskId" TEXT NOT NULL,
  "dependsOnTaskId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_task_views" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "filters" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_task_views_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendar_connections" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'ics', "url" TEXT NOT NULL, "username" TEXT NOT NULL DEFAULT '',
  "passwordEnc" TEXT NOT NULL DEFAULT '', "color" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_versions" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL, "storageKey" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_annotations" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
  "page" INTEGER, "quote" TEXT, "body" TEXT NOT NULL, "color" TEXT, "position" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_annotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "note_attachments" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "noteId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbox_items" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '', "kind" TEXT NOT NULL DEFAULT 'inbox', "dueAt" TIMESTAMP(3),
  "targetType" TEXT, "targetId" TEXT, "projectId" TEXT, "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL DEFAULT '', "entityType" TEXT,
  "entityId" TEXT, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_links" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "label" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");
CREATE INDEX "projects_workspaceId_idx" ON "projects"("workspaceId");
CREATE INDEX "projects_dueAt_idx" ON "projects"("dueAt");
CREATE UNIQUE INDEX "projects_workspaceId_name_key" ON "projects"("workspaceId", "name");
CREATE INDEX "task_dependencies_workspaceId_idx" ON "task_dependencies"("workspaceId");
CREATE INDEX "task_dependencies_dependsOnTaskId_idx" ON "task_dependencies"("dependsOnTaskId");
CREATE UNIQUE INDEX "task_dependencies_taskId_dependsOnTaskId_key" ON "task_dependencies"("taskId", "dependsOnTaskId");
CREATE INDEX "saved_task_views_workspaceId_idx" ON "saved_task_views"("workspaceId");
CREATE UNIQUE INDEX "saved_task_views_workspaceId_name_key" ON "saved_task_views"("workspaceId", "name");
CREATE INDEX "calendar_connections_workspaceId_idx" ON "calendar_connections"("workspaceId");
CREATE INDEX "document_versions_workspaceId_idx" ON "document_versions"("workspaceId");
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");
CREATE INDEX "document_annotations_workspaceId_idx" ON "document_annotations"("workspaceId");
CREATE INDEX "document_annotations_documentId_idx" ON "document_annotations"("documentId");
CREATE INDEX "note_attachments_workspaceId_idx" ON "note_attachments"("workspaceId");
CREATE UNIQUE INDEX "note_attachments_noteId_documentId_key" ON "note_attachments"("noteId", "documentId");
CREATE INDEX "inbox_items_workspaceId_idx" ON "inbox_items"("workspaceId");
CREATE INDEX "inbox_items_processedAt_idx" ON "inbox_items"("processedAt");
CREATE INDEX "notifications_workspaceId_idx" ON "notifications"("workspaceId");
CREATE INDEX "notifications_readAt_idx" ON "notifications"("readAt");
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");
CREATE INDEX "entity_links_workspaceId_idx" ON "entity_links"("workspaceId");
CREATE INDEX "entity_links_targetType_targetId_idx" ON "entity_links"("targetType", "targetId");
CREATE UNIQUE INDEX "entity_links_sourceType_sourceId_targetType_targetId_key" ON "entity_links"("sourceType", "sourceId", "targetType", "targetId");
CREATE INDEX "documents_projectId_idx" ON "documents"("projectId");
CREATE INDEX "events_projectId_idx" ON "events"("projectId");
CREATE INDEX "events_calendarConnectionId_idx" ON "events"("calendarConnectionId");
CREATE UNIQUE INDEX "events_calendarConnectionId_externalUid_key" ON "events"("calendarConnectionId", "externalUid");
CREATE INDEX "finance_transactions_projectId_idx" ON "finance_transactions"("projectId");
CREATE UNIQUE INDEX "finance_transactions_workspaceId_importedRef_key" ON "finance_transactions"("workspaceId", "importedRef");
CREATE INDEX "notes_projectId_idx" ON "notes"("projectId");
CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");
CREATE INDEX "tasks_parentId_idx" ON "tasks"("parentId");

ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_task_views" ADD CONSTRAINT "saved_task_views_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_calendarConnectionId_fkey" FOREIGN KEY ("calendarConnectionId") REFERENCES "calendar_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_attachments" ADD CONSTRAINT "note_attachments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_attachments" ADD CONSTRAINT "note_attachments_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_attachments" ADD CONSTRAINT "note_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_links" ADD CONSTRAINT "entity_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Turn the old free-form task tags into real projects without losing either
-- the tag or any existing task association.
INSERT INTO "projects" ("id", "workspaceId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "workspaceId", "projectTag", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tasks"
WHERE "projectTag" IS NOT NULL AND btrim("projectTag") <> ''
GROUP BY "workspaceId", "projectTag";

UPDATE "tasks" t
SET "projectId" = p."id"
FROM "projects" p
WHERE p."workspaceId" = t."workspaceId" AND p."name" = t."projectTag";
