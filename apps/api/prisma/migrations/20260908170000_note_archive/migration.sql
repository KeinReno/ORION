-- ORION v0.9 "Заметки" phase 6 — archive. A middle state between "active"
-- and "trash": out of the normal list, never auto-purged, still editable.
-- No RLS change: "notes" is already under notes_isolation, which covers
-- every row regardless of archivedAt.
ALTER TABLE "notes" ADD COLUMN "archivedAt" TIMESTAMP(3);
