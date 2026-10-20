-- ADR-0022 E3: данные и секреты расширений из папки.
CREATE TABLE "extension_records" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "extension_records_workspaceId_extensionId_collection_key_key" ON "extension_records"("workspaceId", "extensionId", "collection", "key");
CREATE INDEX "extension_records_workspaceId_extensionId_collection_idx" ON "extension_records"("workspaceId", "extensionId", "collection");

ALTER TABLE "extension_records" ADD CONSTRAINT "extension_records_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "extension_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extension_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_records_isolation ON "extension_records"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "extension_records"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

CREATE TABLE "extension_secrets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extensionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extension_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "extension_secrets_userId_extensionId_name_key" ON "extension_secrets"("userId", "extensionId", "name");

ALTER TABLE "extension_secrets" ADD CONSTRAINT "extension_secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Секрет виден только самому пользователю — даже участникам общих пространств (как assistant_keys).
ALTER TABLE "extension_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extension_secrets" FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_secrets_owner ON "extension_secrets"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
