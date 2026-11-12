-- 07 — Заметки 2.0 (backend): история версий, «битые» wiki-ссылки и
-- per-user состояние визуальных стопок. Только эти изменения: остальные
-- таблицы в базе правят свои задания, и Prisma-drift из их ещё не применённых
-- миграций сюда не копируется.

-- 7.1: пометка «восстановлено из версии» у записи истории.
ALTER TABLE "note_revisions" ADD COLUMN "restoredFrom" TEXT;

-- 7.2: битая ссылка не удаляется, а помечается. Backfill — всё, что уже
-- ссылается в никуда (targetNoteId IS NULL), считается битым.
ALTER TABLE "note_links" ADD COLUMN "broken" BOOLEAN NOT NULL DEFAULT false;
UPDATE "note_links" SET "broken" = true WHERE "targetNoteId" IS NULL;

-- 7.4: свёрнутость и личный порядок стопок. Стопки остаются плоскими —
-- таблица хранит только состояние участника, сама заметка владеет stackId.
CREATE TABLE "note_stack_states" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_stack_states_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_stack_states_workspaceId_userId_idx" ON "note_stack_states"("workspaceId", "userId");
CREATE UNIQUE INDEX "note_stack_states_workspaceId_userId_stackId_key" ON "note_stack_states"("workspaceId", "userId", "stackId");

ALTER TABLE "note_stack_states" ADD CONSTRAINT "note_stack_states_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_stack_states" ADD CONSTRAINT "note_stack_states_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: как у остальных workspace-таблиц (ENABLE + FORCE), плюс состояние
-- стопок видит только сам участник — оно личное, а не общее.
ALTER TABLE "note_stack_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "note_stack_states" FORCE ROW LEVEL SECURITY;
CREATE POLICY note_stack_states_isolation ON "note_stack_states"
  USING (
    "note_stack_states"."userId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "note_stack_states"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
  );
