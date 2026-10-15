-- «Здоровье», журнал симптомов (ADR-0012). Доступ — через health_subject_access.

CREATE TABLE "health_symptoms" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "triggers" TEXT NOT NULL DEFAULT '',
    "relief" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_symptoms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_symptoms_severity_check" CHECK ("severity" BETWEEN 0 AND 10)
);
CREATE INDEX "health_symptoms_workspaceId_idx" ON "health_symptoms"("workspaceId");
CREATE INDEX "health_symptoms_subjectId_startedAt_idx" ON "health_symptoms"("subjectId", "startedAt");
ALTER TABLE "health_symptoms" ADD CONSTRAINT "health_symptoms_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_symptoms" ADD CONSTRAINT "health_symptoms_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "health_symptoms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_symptoms" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_symptoms_select ON "health_symptoms" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_symptoms_insert ON "health_symptoms" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_symptoms_update ON "health_symptoms" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_symptoms_delete ON "health_symptoms" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
