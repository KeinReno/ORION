-- Pet Care (образец модуля по манифесту, G5/G10): таблицы и Row Level Security в одной миграции.
-- Копия этого файла в apps/api/prisma/migrations/ — генерируемая (scripts/module-registry.mjs), правьте здесь.
-- Структурный интеграционный тест api-rls требует ENABLE + FORCE RLS и политику для каждой таблицы с workspaceId.

-- CreateTable
CREATE TABLE "pet_care_pets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL DEFAULT 'other',
    "birthday" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pet_care_pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pet_care_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pet_care_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pet_care_pets_workspaceId_idx" ON "pet_care_pets"("workspaceId");

-- CreateIndex
CREATE INDEX "pet_care_entries_workspaceId_idx" ON "pet_care_entries"("workspaceId");

-- CreateIndex
CREATE INDEX "pet_care_entries_petId_occurredAt_idx" ON "pet_care_entries"("petId", "occurredAt");

-- AddForeignKey
ALTER TABLE "pet_care_pets" ADD CONSTRAINT "pet_care_pets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_care_entries" ADD CONSTRAINT "pet_care_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_care_entries" ADD CONSTRAINT "pet_care_entries_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pet_care_pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "pet_care_pets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pet_care_pets" FORCE ROW LEVEL SECURITY;
CREATE POLICY pet_care_pets_isolation ON "pet_care_pets"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "pet_care_pets"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "pet_care_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pet_care_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY pet_care_entries_isolation ON "pet_care_entries"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "pet_care_entries"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
