-- «Здоровье», показатели (ADR-0012). Доступ — через health_subject_access.

CREATE TABLE "health_measurements" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "value2" DECIMAL(8,2),
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_measurements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_measurements_workspaceId_idx" ON "health_measurements"("workspaceId");
CREATE INDEX "health_measurements_subjectId_kind_measuredAt_idx" ON "health_measurements"("subjectId", "kind", "measuredAt");
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "health_targets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "min" DECIMAL(8,2),
    "max" DECIMAL(8,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_targets_subjectId_kind_key" ON "health_targets"("subjectId", "kind");
CREATE INDEX "health_targets_workspaceId_idx" ON "health_targets"("workspaceId");
ALTER TABLE "health_targets" ADD CONSTRAINT "health_targets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_targets" ADD CONSTRAINT "health_targets_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "health_measurements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_measurements" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_measurements_select ON "health_measurements" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_measurements_insert ON "health_measurements" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_measurements_update ON "health_measurements" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_measurements_delete ON "health_measurements" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));

ALTER TABLE "health_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_targets_select ON "health_targets" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_targets_insert ON "health_targets" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_targets_update ON "health_targets" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_targets_delete ON "health_targets" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
