-- Pet Care: дневник самочувствия (перенос MurHP). Профиль питомца + записи по дням + события.
-- RLS для новых таблиц добавляет scripts/module-registry.mjs (rls: "workspace-member"); копия в apps/api/prisma/migrations/ генерируется.

-- AlterTable
ALTER TABLE "pet_care_pets" ADD COLUMN "breed" TEXT NOT NULL DEFAULT '',
ADD COLUMN "vetContact" TEXT NOT NULL DEFAULT '',
ADD COLUMN "chronic" TEXT NOT NULL DEFAULT '',
ADD COLUMN "allergies" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "pet_care_days" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "statusAuto" BOOLEAN NOT NULL DEFAULT true,
    "appetite" TEXT NOT NULL DEFAULT '',
    "activity" TEXT NOT NULL DEFAULT '',
    "stool" TEXT NOT NULL DEFAULT '',
    "water" TEXT NOT NULL DEFAULT '',
    "vomitingCount" INTEGER NOT NULL DEFAULT 0,
    "weightKg" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "meds" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "symptoms" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_care_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_care_events" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'note',
    "title" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_care_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pet_care_days_petId_day_key" ON "pet_care_days"("petId", "day");

-- CreateIndex
CREATE INDEX "pet_care_days_workspaceId_idx" ON "pet_care_days"("workspaceId");

-- CreateIndex
CREATE INDEX "pet_care_events_workspaceId_idx" ON "pet_care_events"("workspaceId");

-- CreateIndex
CREATE INDEX "pet_care_events_petId_day_idx" ON "pet_care_events"("petId", "day");

-- AddForeignKey
ALTER TABLE "pet_care_days" ADD CONSTRAINT "pet_care_days_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_care_days" ADD CONSTRAINT "pet_care_days_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet_care_pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_care_events" ADD CONSTRAINT "pet_care_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_care_events" ADD CONSTRAINT "pet_care_events_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet_care_pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "pet_care_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pet_care_days" FORCE ROW LEVEL SECURITY;
CREATE POLICY pet_care_days_isolation ON "pet_care_days"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "pet_care_days"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "pet_care_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pet_care_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY pet_care_events_isolation ON "pet_care_events"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "pet_care_events"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
