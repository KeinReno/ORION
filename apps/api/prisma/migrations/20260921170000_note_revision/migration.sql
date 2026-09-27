-- S11: optimistic-concurrency counter for notes (CAS).
-- Every existing row starts at revision 1, same as a freshly created note.
ALTER TABLE "notes" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
