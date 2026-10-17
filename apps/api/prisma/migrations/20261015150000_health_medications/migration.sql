-- «Здоровье», лекарства и приёмы (ADR-0012). Доступ — через health_subject_access, как у остальных таблиц модуля.

CREATE TABLE "health_medications" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "form" TEXT NOT NULL DEFAULT '',
    "dose" TEXT NOT NULL DEFAULT '',
    "times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startOn" DATE,
    "endOn" DATE,
    "asNeeded" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER,
    "lowStockAt" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_medications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_medications_workspaceId_idx" ON "health_medications"("workspaceId");
CREATE INDEX "health_medications_subjectId_idx" ON "health_medications"("subjectId");
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "health_intakes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_intakes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_intakes_status_check" CHECK ("status" IN ('taken', 'skipped'))
);
CREATE UNIQUE INDEX "health_intakes_medicationId_day_time_key" ON "health_intakes"("medicationId", "day", "time");
CREATE INDEX "health_intakes_workspaceId_idx" ON "health_intakes"("workspaceId");
CREATE INDEX "health_intakes_subjectId_day_idx" ON "health_intakes"("subjectId", "day");
ALTER TABLE "health_intakes" ADD CONSTRAINT "health_intakes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_intakes" ADD CONSTRAINT "health_intakes_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "health_medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "health_medications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_medications" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_medications_select ON "health_medications" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_medications_insert ON "health_medications" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_medications_update ON "health_medications" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_medications_delete ON "health_medications" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));

ALTER TABLE "health_intakes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_intakes" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_intakes_select ON "health_intakes" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_intakes_insert ON "health_intakes" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_intakes_update ON "health_intakes" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_intakes_delete ON "health_intakes" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
