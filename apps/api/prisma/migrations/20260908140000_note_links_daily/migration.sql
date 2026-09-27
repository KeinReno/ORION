-- ORION v0.9 "Заметки" phase 3 — [[wiki links]] index + daily notes.
-- RLS for "note_links" is in the migration that follows, matching the
-- per-table split used for notes/tasks/finance/events (CLAUDE.md checklist).

-- AlterTable: the calendar date this note is the "daily note" for. Plain
-- DATE (no time). NULL for ordinary notes; Postgres treats NULLs as
-- distinct, so the unique index below still allows many null rows.
ALTER TABLE "notes" ADD COLUMN "dailyOn" DATE;

-- CreateTable: one [[wiki link]] from a note's body to another note by
-- title. Derived — NotesService rebuilds it on every save. "targetNoteId"
-- is NULL while "targetTitle" resolves to no live note.
CREATE TABLE "note_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceNoteId" TEXT NOT NULL,
    "targetNoteId" TEXT,
    "targetTitle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "note_links_sourceNoteId_targetTitle_key" ON "note_links"("sourceNoteId", "targetTitle");

CREATE INDEX "note_links_workspaceId_idx" ON "note_links"("workspaceId");

CREATE INDEX "note_links_targetNoteId_idx" ON "note_links"("targetNoteId");

CREATE UNIQUE INDEX "notes_workspaceId_dailyOn_key" ON "notes"("workspaceId", "dailyOn");

ALTER TABLE "note_links" ADD CONSTRAINT "note_links_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_links" ADD CONSTRAINT "note_links_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_links" ADD CONSTRAINT "note_links_targetNoteId_fkey" FOREIGN KEY ("targetNoteId") REFERENCES "notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
