-- CreateTable
CREATE TABLE "habits" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "color" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "habit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "habits_workspaceId_idx" ON "habits"("workspaceId");

-- CreateIndex
CREATE INDEX "habit_entries_workspaceId_idx" ON "habit_entries"("workspaceId");

-- CreateIndex
CREATE INDEX "habit_entries_habitId_day_idx" ON "habit_entries"("habitId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "habit_entries_habitId_day_key" ON "habit_entries"("habitId", "day");

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
