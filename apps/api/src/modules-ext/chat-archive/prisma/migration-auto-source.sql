-- ORION-16: тумблер автосбора локальных транскриптов по источнику (claude-code | codex), выключен по умолчанию.
-- Личный, как сам архив (chat_archive_conversations) — та же политика RLS: владелец строки И участник пространства.

-- CreateTable
CREATE TABLE "chat_archive_auto_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_archive_auto_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_archive_auto_sources_key" ON "chat_archive_auto_sources"("workspaceId", "userId", "source");
CREATE INDEX "chat_archive_auto_sources_workspaceId_idx" ON "chat_archive_auto_sources"("workspaceId");

-- AddForeignKey
ALTER TABLE "chat_archive_auto_sources" ADD CONSTRAINT "chat_archive_auto_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: владелец строки и участник пространства (как chat_archive_conversations_owner).
ALTER TABLE "chat_archive_auto_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_archive_auto_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_archive_auto_sources_owner ON "chat_archive_auto_sources"
  USING (
    "userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "chat_archive_auto_sources"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
