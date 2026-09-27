-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('planned', 'in_progress', 'done');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "contextNote" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "milestoneId" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "MilestoneStatus" NOT NULL DEFAULT 'planned',
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_dependencies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "dependsOnMilestoneId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestone_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_workspaceId_idx" ON "milestones"("workspaceId");

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "milestone_dependencies_workspaceId_idx" ON "milestone_dependencies"("workspaceId");

-- CreateIndex
CREATE INDEX "milestone_dependencies_dependsOnMilestoneId_idx" ON "milestone_dependencies"("dependsOnMilestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_dependencies_milestoneId_dependsOnMilestoneId_key" ON "milestone_dependencies"("milestoneId", "dependsOnMilestoneId");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_dependencies" ADD CONSTRAINT "milestone_dependencies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_dependencies" ADD CONSTRAINT "milestone_dependencies_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_dependencies" ADD CONSTRAINT "milestone_dependencies_dependsOnMilestoneId_fkey" FOREIGN KEY ("dependsOnMilestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
