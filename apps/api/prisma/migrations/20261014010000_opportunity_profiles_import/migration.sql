-- CreateTable
CREATE TABLE "opportunity_profiles" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'person',
    "ownerUserId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_facts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'experience',
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unverified',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_tracks" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factIds" JSONB NOT NULL DEFAULT '[]',
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_materials" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "trackId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'resume',
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourcePath" TEXT,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_imports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "checkpoint" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "manifestHash" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_captures" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "historical" BOOLEAN NOT NULL DEFAULT true,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_history" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "profileId" TEXT,
    "importRunId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "originalStatus" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "sourceTime" TEXT,
    "sourcePath" TEXT NOT NULL,
    "recordHash" TEXT NOT NULL,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunity_profiles_workspaceId_idx" ON "opportunity_profiles"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_profile_scope" ON "opportunity_profiles"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_profile_source" ON "opportunity_profiles"("workspaceId", "sourceKey");

-- CreateIndex
CREATE INDEX "opportunity_facts_workspaceId_idx" ON "opportunity_facts"("workspaceId");

-- CreateIndex
CREATE INDEX "opportunity_tracks_workspaceId_idx" ON "opportunity_tracks"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_track_source" ON "opportunity_tracks"("workspaceId", "profileId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_track_scope" ON "opportunity_tracks"("id", "workspaceId", "profileId");

-- CreateIndex
CREATE INDEX "opportunity_materials_workspaceId_idx" ON "opportunity_materials"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_material_source_hash" ON "opportunity_materials"("workspaceId", "profileId", "sourceKey", "contentHash");

-- CreateIndex
CREATE INDEX "opportunity_imports_workspaceId_idx" ON "opportunity_imports"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_import_scope" ON "opportunity_imports"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "opportunity_captures_workspaceId_idx" ON "opportunity_captures"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_capture_hash" ON "opportunity_captures"("workspaceId", "opportunityId", "contentHash");

-- CreateIndex
CREATE INDEX "opportunity_history_workspaceId_idx" ON "opportunity_history"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_history_hash" ON "opportunity_history"("workspaceId", "recordHash");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_scope" ON "opportunities"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "opportunity_profiles" ADD CONSTRAINT "opportunity_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_facts" ADD CONSTRAINT "opportunity_facts_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_facts" ADD CONSTRAINT "opportunity_facts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_tracks" ADD CONSTRAINT "opportunity_tracks_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_tracks" ADD CONSTRAINT "opportunity_tracks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_materials" ADD CONSTRAINT "opportunity_materials_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_materials" ADD CONSTRAINT "opportunity_materials_trackId_workspaceId_profileId_fkey" FOREIGN KEY ("trackId", "workspaceId", "profileId") REFERENCES "opportunity_tracks"("id", "workspaceId", "profileId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_materials" ADD CONSTRAINT "opportunity_materials_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_imports" ADD CONSTRAINT "opportunity_imports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_captures" ADD CONSTRAINT "opportunity_captures_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_captures" ADD CONSTRAINT "opportunity_captures_importRunId_workspaceId_fkey" FOREIGN KEY ("importRunId", "workspaceId") REFERENCES "opportunity_imports"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_captures" ADD CONSTRAINT "opportunity_captures_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_importRunId_workspaceId_fkey" FOREIGN KEY ("importRunId", "workspaceId") REFERENCES "opportunity_imports"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "opportunity_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_profiles_isolation ON "opportunity_profiles" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_profiles"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_facts" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_facts_isolation ON "opportunity_facts" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_facts"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_tracks" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_tracks_isolation ON "opportunity_tracks" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_tracks"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_materials" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_materials_isolation ON "opportunity_materials" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_materials"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_imports" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_imports_isolation ON "opportunity_imports" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_imports"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_captures" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_captures_isolation ON "opportunity_captures" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_captures"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_history_isolation ON "opportunity_history" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_history"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
