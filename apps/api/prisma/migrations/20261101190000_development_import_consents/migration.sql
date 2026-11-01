CREATE TABLE "development_import_consents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "catalogId" TEXT NOT NULL,
  "catalogSha256" TEXT NOT NULL,
  "previewDigest" TEXT NOT NULL,
  "selectionHash" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "development_import_consents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "development_import_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "development_import_consents_tokenHash_key" ON "development_import_consents"("tokenHash");
CREATE INDEX "development_import_consents_workspaceId_userId_expiresAt_idx" ON "development_import_consents"("workspaceId", "userId", "expiresAt");

ALTER TABLE "development_import_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_import_consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "development_import_consents_read" ON "development_import_consents"
  FOR SELECT USING (
    "userId" = NULLIF(current_setting('app.current_user_id', true), '')
    AND EXISTS (SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "development_import_consents"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
      AND wm."role" IN ('owner', 'lead'))
  );
CREATE POLICY "development_import_consents_insert" ON "development_import_consents"
  FOR INSERT WITH CHECK (
    "userId" = NULLIF(current_setting('app.current_user_id', true), '')
    AND EXISTS (SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "development_import_consents"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
      AND wm."role" IN ('owner', 'lead'))
  );
