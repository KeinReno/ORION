-- Архив чатов (модуль по манифесту, G5/G10/G15): таблицы и Row Level Security в одной миграции.
-- Копия этого файла в apps/api/prisma/migrations/ — генерируемая (scripts/module-registry.mjs), правьте здесь.
-- Архив ЛИЧНЫЙ: политика пускает только владельца строки, и только пока он участник пространства
-- (как assistant_conversations). Поэтому RLS написан руками, а не шаблоном workspace-member.

-- CreateTable
CREATE TABLE "chat_archive_conversations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleSource" TEXT NOT NULL DEFAULT 'fallback',
    "projectPath" TEXT,
    "startedAt" TIMESTAMP(3),
    "lastAt" TIMESTAMP(3),
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_archive_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_archive_lines" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "raw" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "at" TIMESTAMP(3),

    CONSTRAINT "chat_archive_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_archive_conversations_session_key" ON "chat_archive_conversations"("workspaceId", "userId", "source", "externalId");
CREATE INDEX "chat_archive_conversations_workspaceId_userId_lastAt_idx" ON "chat_archive_conversations"("workspaceId", "userId", "lastAt");
CREATE UNIQUE INDEX "chat_archive_lines_conversationId_seq_key" ON "chat_archive_lines"("conversationId", "seq");
CREATE INDEX "chat_archive_lines_workspaceId_idx" ON "chat_archive_lines"("workspaceId");

-- AddForeignKey
ALTER TABLE "chat_archive_conversations" ADD CONSTRAINT "chat_archive_conversations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_archive_lines" ADD CONSTRAINT "chat_archive_lines_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_archive_lines" ADD CONSTRAINT "chat_archive_lines_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_archive_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: владелец строки и участник пространства.
ALTER TABLE "chat_archive_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_archive_conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_archive_conversations_owner ON "chat_archive_conversations"
  USING (
    "userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "chat_archive_conversations"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));

ALTER TABLE "chat_archive_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_archive_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY chat_archive_lines_owner ON "chat_archive_lines"
  USING (
    "userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "chat_archive_lines"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
