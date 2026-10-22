-- Checklist items on a task, and per-visit stool notes on a pet day.
ALTER TABLE "tasks" ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "pet_care_days" ADD COLUMN "stoolVisits" JSONB NOT NULL DEFAULT '[]';
