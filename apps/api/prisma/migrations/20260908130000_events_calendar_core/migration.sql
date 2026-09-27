-- ORION v0.10 "Календарь" — first-class calendar events. See docs/PLAN.md.

-- AlterTable: read-only .ics feed credential (backfilled + made NOT NULL-ish
-- via the RLS/backfill migration that follows; kept nullable here for the
-- two-step so existing rows don't block the ADD COLUMN).
ALTER TABLE "workspaces" ADD COLUMN "icsToken" TEXT;

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "url" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "tz" TEXT,
    "colorTag" TEXT,
    "recurrence" JSONB,
    "reminders" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_overrides" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "location" TEXT,
    "url" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "colorTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sent_reminders" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_icsToken_key" ON "workspaces"("icsToken");

-- CreateIndex
CREATE INDEX "events_workspaceId_idx" ON "events"("workspaceId");

-- CreateIndex
CREATE INDEX "events_startAt_idx" ON "events"("startAt");

-- CreateIndex
CREATE INDEX "event_overrides_workspaceId_idx" ON "event_overrides"("workspaceId");

-- CreateIndex
CREATE INDEX "event_overrides_eventId_idx" ON "event_overrides"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_overrides_eventId_occurrenceStart_key" ON "event_overrides"("eventId", "occurrenceStart");

-- CreateIndex
CREATE INDEX "sent_reminders_workspaceId_idx" ON "sent_reminders"("workspaceId");

-- CreateIndex
CREATE INDEX "sent_reminders_eventId_idx" ON "sent_reminders"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "sent_reminders_eventId_occurrenceStart_offsetMinutes_key" ON "sent_reminders"("eventId", "occurrenceStart", "offsetMinutes");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_overrides" ADD CONSTRAINT "event_overrides_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_reminders" ADD CONSTRAINT "sent_reminders_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
