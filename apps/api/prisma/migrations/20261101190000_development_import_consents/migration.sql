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
