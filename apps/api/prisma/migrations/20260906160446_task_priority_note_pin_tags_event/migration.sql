-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high');

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "eventAt" TIMESTAMP(3),
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'normal';

-- CreateIndex
CREATE INDEX "notes_eventAt_idx" ON "notes"("eventAt");
