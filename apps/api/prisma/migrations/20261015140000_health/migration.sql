-- Module «Здоровье» (ADR-0012): data is owned by a PERSON (health_subjects), not by the workspace.

CREATE TABLE "health_subjects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "guardianUserId" TEXT,
    "name" TEXT NOT NULL,
    "birthDate" DATE,
    "bloodType" TEXT NOT NULL DEFAULT '',
    "allergies" JSONB NOT NULL DEFAULT '[]',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "emergencyNote" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_subjects_pkey" PRIMARY KEY ("id"),
    -- A person is either a member keeping their own data or a dependent with a guardian — never both, never neither.
    CONSTRAINT "health_subjects_owner_check" CHECK (("userId" IS NULL) <> ("guardianUserId" IS NULL))
);
CREATE UNIQUE INDEX "health_subjects_workspaceId_userId_key" ON "health_subjects"("workspaceId", "userId");
CREATE INDEX "health_subjects_workspaceId_idx" ON "health_subjects"("workspaceId");
CREATE INDEX "health_subjects_guardianUserId_idx" ON "health_subjects"("guardianUserId");
ALTER TABLE "health_subjects" ADD CONSTRAINT "health_subjects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_subjects" ADD CONSTRAINT "health_subjects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_subjects" ADD CONSTRAINT "health_subjects_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "health_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "health_grants_level_check" CHECK ("level" IN ('read', 'write'))
);
CREATE UNIQUE INDEX "health_grants_subjectId_granteeUserId_key" ON "health_grants"("subjectId", "granteeUserId");
CREATE INDEX "health_grants_workspaceId_idx" ON "health_grants"("workspaceId");
CREATE INDEX "health_grants_granteeUserId_idx" ON "health_grants"("granteeUserId");
ALTER TABLE "health_grants" ADD CONSTRAINT "health_grants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_grants" ADD CONSTRAINT "health_grants_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_grants" ADD CONSTRAINT "health_grants_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "health_appointments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "doctorContactId" TEXT,
    "clinic" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL DEFAULT '',
    "questions" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_appointments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_appointments_workspaceId_idx" ON "health_appointments"("workspaceId");
CREATE INDEX "health_appointments_subjectId_at_idx" ON "health_appointments"("subjectId", "at");
ALTER TABLE "health_appointments" ADD CONSTRAINT "health_appointments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_appointments" ADD CONSTRAINT "health_appointments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_appointments" ADD CONSTRAINT "health_appointments_doctorContactId_fkey" FOREIGN KEY ("doctorContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "health_preventive_items" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'checkup',
    "everyMonths" INTEGER,
    "firstDueAt" DATE,
    "lastDoneAt" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_preventive_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_preventive_items_workspaceId_idx" ON "health_preventive_items"("workspaceId");
CREATE INDEX "health_preventive_items_subjectId_idx" ON "health_preventive_items"("subjectId");
ALTER TABLE "health_preventive_items" ADD CONSTRAINT "health_preventive_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_preventive_items" ADD CONSTRAINT "health_preventive_items_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "health_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The module is OFF by default: new workspaces get it from the column default, existing ones here.
ALTER TABLE "workspaces" ALTER COLUMN "disabledModules" SET DEFAULT ARRAY['markets', 'health']::TEXT[];
UPDATE "workspaces" SET "disabledModules" = array_append("disabledModules", 'health') WHERE NOT ('health' = ANY("disabledModules"));

-- ---------------------------------------------------------------------------------------------
-- Row Level Security: access follows the PERSON, not the workspace (ADR-0012).
--
-- `health_subject_access` answers 'own' | 'write' | 'read' | NULL. It is SECURITY DEFINER because the
-- subjects' and grants' policies would otherwise reference each other and recurse forever; the function
-- reads the tables as its owner (the migration role, which bypasses RLS) and only ever returns the
-- caller's OWN level, never rows. A member who left the workspace gets NULL.
CREATE FUNCTION health_subject_access(subject_id TEXT, uid TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN s."userId" = uid OR s."guardianUserId" = uid THEN 'own'
    ELSE (SELECT g."level" FROM "health_grants" g WHERE g."subjectId" = s."id" AND g."granteeUserId" = uid)
  END
  FROM "health_subjects" s
  WHERE s."id" = subject_id
    AND EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = s."workspaceId" AND wm."userId" = uid)
$$;
REVOKE ALL ON FUNCTION health_subject_access(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION health_subject_access(TEXT, TEXT) TO orion_app, orion_system;

ALTER TABLE "health_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_subjects" FORCE ROW LEVEL SECURITY;
-- The owner branch reads the columns directly: `INSERT ... RETURNING` evaluates this policy for the row
-- being inserted, which a STABLE function (statement snapshot) cannot see yet.
CREATE POLICY health_subjects_select ON "health_subjects" FOR SELECT
  USING (
    (("userId" = current_setting('app.current_user_id', true) OR "guardianUserId" = current_setting('app.current_user_id', true))
      AND EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "health_subjects"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true)))
    OR health_subject_access("id", current_setting('app.current_user_id', true)) IS NOT NULL
  );
CREATE POLICY health_subjects_insert ON "health_subjects" FOR INSERT
  WITH CHECK (
    ("userId" = current_setting('app.current_user_id', true) OR "guardianUserId" = current_setting('app.current_user_id', true))
    AND EXISTS (SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "health_subjects"."workspaceId" AND wm."userId" = current_setting('app.current_user_id', true))
  );
CREATE POLICY health_subjects_update ON "health_subjects" FOR UPDATE
  USING (health_subject_access("id", current_setting('app.current_user_id', true)) = 'own')
  WITH CHECK ("userId" = current_setting('app.current_user_id', true) OR "guardianUserId" = current_setting('app.current_user_id', true));
CREATE POLICY health_subjects_delete ON "health_subjects" FOR DELETE
  USING (health_subject_access("id", current_setting('app.current_user_id', true)) = 'own');

ALTER TABLE "health_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_grants_select ON "health_grants" FOR SELECT
  USING ("granteeUserId" = current_setting('app.current_user_id', true)
    OR health_subject_access("subjectId", current_setting('app.current_user_id', true)) = 'own');
CREATE POLICY health_grants_insert ON "health_grants" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) = 'own');
CREATE POLICY health_grants_update ON "health_grants" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) = 'own')
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) = 'own');
CREATE POLICY health_grants_delete ON "health_grants" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) = 'own');

ALTER TABLE "health_appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_appointments_select ON "health_appointments" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_appointments_insert ON "health_appointments" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_appointments_update ON "health_appointments" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_appointments_delete ON "health_appointments" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));

ALTER TABLE "health_preventive_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_preventive_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY health_preventive_items_select ON "health_preventive_items" FOR SELECT
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IS NOT NULL);
CREATE POLICY health_preventive_items_insert ON "health_preventive_items" FOR INSERT
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_preventive_items_update ON "health_preventive_items" FOR UPDATE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'))
  WITH CHECK (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
CREATE POLICY health_preventive_items_delete ON "health_preventive_items" FOR DELETE
  USING (health_subject_access("subjectId", current_setting('app.current_user_id', true)) IN ('own', 'write'));
