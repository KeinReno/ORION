-- UI-03: optional short note description. NOT NULL DEFAULT '' so existing rows
-- and old backups (which have no such column) stay valid without a backfill.
ALTER TABLE "notes" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';

-- The summary must be searchable, otherwise a user types a description and
-- cannot find the note by it. The query in NotesService.list repeats this exact
-- expression, so the index and the query have to change together.
DROP INDEX "notes_search_idx";
CREATE INDEX "notes_search_idx" ON "notes"
  USING GIN (to_tsvector('russian', "title" || ' ' || "summary" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' ')));
