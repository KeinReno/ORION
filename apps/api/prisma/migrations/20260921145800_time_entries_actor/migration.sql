-- S06 «Личные таймеры»: "один запущенный таймер на workspace" was wrong for the
-- team scenario (equal priority with solo, see CLAUDE.md) — it let user A block
-- user B from starting their own timer in a shared workspace. The invariant is
-- actually "one running timer per (workspace, user)".
--
-- 1) Add the actor column. Nullable: existing rows predate this column and
--    their true author is not recoverable from data alone — do NOT backfill
--    them to the workspace owner (that would silently misattribute someone
--    else's work). They stay author-unknown; reports must label them as such,
--    an admin-facing reassignment tool is out of scope here (see
--    docs/SONNET_IMPLEMENTATION/12-PROGRESS.md, S06 entry, runbook TODO).
ALTER TABLE "time_entries" ADD COLUMN "userId" TEXT;

CREATE INDEX "time_entries_userId_idx" ON "time_entries"("userId");

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Replace the workspace-wide "one running timer" index with a composite one
--    scoped to (workspaceId, userId). A user can now have at most one running
--    timer per workspace, but independently running timers in *different*
--    workspaces are fine (not the same identity racing itself), and two
--    different users in the same workspace no longer collide at all.
--
--    Legacy rows with userId = NULL are NOT covered by this index (a partial
--    unique index over columns that are all NULL for a given row does not
--    constrain that row under Postgres NULL-distinctness — every NULL is
--    distinct from every other NULL). That is intentional: we cannot tell
--    whether two author-unknown running rows in the same workspace are "the
--    same person forgetting to stop a timer" or not, so the DB does not guess.
DROP INDEX IF EXISTS "time_entries_one_running_per_workspace";

CREATE UNIQUE INDEX "time_entries_one_running_per_workspace_user"
  ON "time_entries" ("workspaceId", "userId")
  WHERE "endedAt" IS NULL;
