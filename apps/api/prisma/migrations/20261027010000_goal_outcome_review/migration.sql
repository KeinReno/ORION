ALTER TABLE "goals"
  ADD COLUMN "successCriteria" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "reviewWins" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reviewBlockers" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reviewNext" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reviewedAt" TIMESTAMP(3);
