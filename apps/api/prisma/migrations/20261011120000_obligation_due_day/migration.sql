-- The day of month an obligation falls on, so a "31st" payment is not dragged to the 28th for good by February.
ALTER TABLE "finance_obligations" ADD COLUMN "dueDay" INTEGER;
UPDATE "finance_obligations" SET "dueDay" = EXTRACT(DAY FROM "nextDueAt" AT TIME ZONE 'UTC')::INTEGER WHERE "nextDueAt" IS NOT NULL;
