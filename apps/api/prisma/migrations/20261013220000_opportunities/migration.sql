CREATE TABLE "opportunities" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspaceId" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "title" TEXT NOT NULL,
 "organizationName" TEXT NOT NULL DEFAULT '', "description" TEXT NOT NULL DEFAULT '',
 "sourceType" TEXT NOT NULL DEFAULT 'manual', "canonicalUrl" TEXT, "externalId" TEXT,
 "status" TEXT NOT NULL DEFAULT 'new', "conditions" JSONB NOT NULL DEFAULT '{}',
 "history" JSONB NOT NULL DEFAULT '[]', "revision" INTEGER NOT NULL DEFAULT 0,
 "capturedAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "opportunities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "opportunities_workspaceId_sourceType_externalId_key" ON "opportunities"("workspaceId", "sourceType", "externalId");
CREATE INDEX "opportunities_workspaceId_archivedAt_id_idx" ON "opportunities"("workspaceId", "archivedAt", "id");
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunities_isolation ON "opportunities" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunities"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
