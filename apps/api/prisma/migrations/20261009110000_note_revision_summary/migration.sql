-- UI-03: version history keeps the note description, so a restore is complete.
-- Old revisions get '' (they were taken before the field existed).
ALTER TABLE "note_revisions" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';
