-- ORION v0.9 "Заметки" phase 4 — content version history.
-- RLS for "note_revisions" is in the migration that follows (per-table
-- split, like notes/tasks/finance/events/note_links).

CREATE TABLE "note_revisions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_revisions_workspaceId_idx" ON "note_revisions"("workspaceId");

CREATE INDEX "note_revisions_noteId_createdAt_idx" ON "note_revisions"("noteId", "createdAt");

ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
