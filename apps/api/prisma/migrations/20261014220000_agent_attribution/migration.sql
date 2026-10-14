-- AI Bridge attribution (ADR-0007): changes made through /ai/v1 are distinguishable from the human's own.
-- Additive, nullable columns only; RLS on both tables is unchanged (workspace policies already cover new columns).
ALTER TABLE "task_activities" ADD COLUMN "agentName" TEXT;
ALTER TABLE "notes" ADD COLUMN "createdByAgent" TEXT;
ALTER TABLE "notes" ADD COLUMN "editedByAgent" TEXT;
