-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT,
    "projectId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_workspaceId_idx" ON "time_entries"("workspaceId");

-- CreateIndex
CREATE INDEX "time_entries_taskId_idx" ON "time_entries"("taskId");

-- CreateIndex
CREATE INDEX "time_entries_projectId_idx" ON "time_entries"("projectId");

-- CreateIndex
CREATE INDEX "time_entries_startedAt_idx" ON "time_entries"("startedAt");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one *running* timer per workspace ("endedAt IS NULL"). Enforced by the
-- database rather than only by TimeService.start: two device tabs pressing
-- "Старт" at the same moment must not leave two timers running, and a partial
-- unique index is the only construct that expresses this (Prisma's schema
-- language has no `WHERE` indexes — same reason the v0.7 full-text GIN indexes
-- live in raw SQL).
CREATE UNIQUE INDEX "time_entries_one_running_per_workspace"
  ON "time_entries" ("workspaceId")
  WHERE "endedAt" IS NULL;
