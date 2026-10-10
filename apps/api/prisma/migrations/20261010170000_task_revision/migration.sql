-- Optimistic-concurrency token for tasks (same idea as notes.revision). Existing rows start at 1.
ALTER TABLE "tasks" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
