-- 05 — LOG BOOK: typed entries, decision rationale/alternatives, hypothesis due,
-- result verdict, incident severity/resolution, and event-sourced change rows.
--
-- Existing rows keep their historical value: `kind` already used the
-- observation/decision/change subset, so renaming the column preserves the
-- author's intent instead of flattening every old decision into "observation".
-- Rows written before this migration are human-authored, hence source='manual'.

ALTER TYPE "ProjectLogKind" RENAME TO "ProjectLogEntryType";
ALTER TYPE "ProjectLogEntryType" ADD VALUE IF NOT EXISTS 'hypothesis';
ALTER TYPE "ProjectLogEntryType" ADD VALUE IF NOT EXISTS 'result';
ALTER TYPE "ProjectLogEntryType" ADD VALUE IF NOT EXISTS 'incident';

CREATE TYPE "ProjectLogSeverity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "ProjectLogSource" AS ENUM ('manual', 'event');
CREATE TYPE "ProjectLogVerdict" AS ENUM ('confirms', 'refutes');

ALTER TABLE "project_log_entries" RENAME COLUMN "kind" TO "type";
ALTER TABLE "project_log_entries"
  ADD COLUMN "rationale" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "alternatives" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "verificationDue" TIMESTAMP(3),
  ADD COLUMN "confirmsEntryId" TEXT,
  ADD COLUMN "severity" "ProjectLogSeverity",
  ADD COLUMN "resolution" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "verdict" "ProjectLogVerdict",
  ADD COLUMN "source" "ProjectLogSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "sourceEventType" TEXT,
  ADD COLUMN "dedupeKey" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One auto entry per bulk operation: the subscriber stores
-- `bulk:<eventType>:<bulkId>` and a retry/second event of the same bulk hits
-- this unique index instead of appending a duplicate row.
CREATE UNIQUE INDEX "project_log_entries_projectId_dedupeKey_key"
  ON "project_log_entries"("projectId", "dedupeKey");
CREATE INDEX "project_log_entries_projectId_type_createdAt_idx"
  ON "project_log_entries"("projectId", "type", "createdAt");

ALTER TABLE "project_log_entries"
  ADD CONSTRAINT "project_log_entries_confirmsEntryId_fkey"
  FOREIGN KEY ("confirmsEntryId") REFERENCES "project_log_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  -- Deferred so a backup/restore that inserts a result before its hypothesis in
  -- the same transaction still satisfies the self-reference.
  DEFERRABLE INITIALLY DEFERRED;
