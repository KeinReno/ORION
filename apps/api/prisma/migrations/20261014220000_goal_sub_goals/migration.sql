-- Nested goals: a goal may have a parent goal (depth <= 3 is enforced by the service).
ALTER TABLE "goals" ADD COLUMN "parentId" TEXT;
ALTER TABLE "goals" ADD COLUMN "subWeight" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "goals_parentId_idx" ON "goals"("parentId");
ALTER TABLE "goals" ADD CONSTRAINT "goals_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
