-- Short stable note id ("N-104"). A per-workspace running number: it does not
-- change with sorting, filtering or a rename, and is unique inside the workspace.
--
-- The number is assigned by a BEFORE INSERT trigger rather than by each
-- service: notes are created from several places (the notes service, the
-- inbox, the daily note, the workspace seed) and a backup restore inserts rows
-- too — one place in the database covers all of them. The advisory lock is per
-- workspace and transaction-scoped, so two concurrent inserts cannot read the
-- same MAX and collide.
--
-- Trashed notes still count (they are soft-deleted rows), so the number of a
-- deleted note is not handed out again until it is purged for good.
ALTER TABLE "notes" ADD COLUMN "number" INTEGER;

UPDATE "notes" AS n
SET "number" = r.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "workspaceId" ORDER BY "createdAt", "id") AS rn
  FROM "notes"
) AS r
WHERE n."id" = r."id";

CREATE OR REPLACE FUNCTION "notes_assign_number"() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('notes_number:' || NEW."workspaceId"));
    SELECT COALESCE(MAX("number"), 0) + 1 INTO NEW."number" FROM "notes" WHERE "workspaceId" = NEW."workspaceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notes_assign_number" BEFORE INSERT ON "notes"
FOR EACH ROW EXECUTE FUNCTION "notes_assign_number"();

CREATE UNIQUE INDEX "notes_workspaceId_number_key" ON "notes"("workspaceId", "number");

-- Showing the id is a personal choice, off by default.
ALTER TABLE "user_preferences" ADD COLUMN "showNoteIds" BOOLEAN NOT NULL DEFAULT false;
