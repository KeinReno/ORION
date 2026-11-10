-- NOTES 2.0: visual grouping belongs to each note row so private-note RLS and snapshots stay authoritative.
ALTER TABLE "notes"
  ADD COLUMN "stackId" TEXT,
  ADD COLUMN "stackTitle" TEXT,
  ADD COLUMN "stackOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "notes_workspaceId_stackId_stackOrder_idx" ON "notes"("workspaceId", "stackId", "stackOrder");
