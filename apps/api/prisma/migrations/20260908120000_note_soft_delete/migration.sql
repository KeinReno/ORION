-- ORION v0.8 "Заметки" phase 1 — soft delete + a content-change timestamp
-- (see docs/PLAN.md). No RLS changes: "notes" is already under the
-- notes_isolation policy (20260905121419_enable_rls), and that policy applies
-- to every row of the table regardless of deletedAt — trashed rows stay
-- workspace-isolated exactly like live ones.

-- "изменено тогда-то" that a pin/unpin must NOT bump — NotesService sets it
-- only on a title/body/tags change. Nullable so the ADD COLUMN is instant on
-- a large table; backfilled from updatedAt just below so existing notes keep
-- a sensible "изменённые" sort position.
ALTER TABLE "notes" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Non-null = trashed. Kept indexed because every active-notes list query
-- filters on `deletedAt IS NULL` and the purge cron scans `deletedAt <= ...`.
ALTER TABLE "notes" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "notes_deletedAt_idx" ON "notes"("deletedAt");

UPDATE "notes" SET "editedAt" = "updatedAt" WHERE "editedAt" IS NULL;
