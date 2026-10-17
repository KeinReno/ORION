-- Opportunity assistant (R0.3): immutable assessments and editable response drafts.
-- Local data only: nothing here carries a send permission or a credential.

-- CreateTable
CREATE TABLE "opportunity_assessments" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "score" INTEGER,
    "confidence" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_drafts" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "kind" TEXT NOT NULL,
    "question" TEXT,
    "sections" JSONB NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "materials" JSONB NOT NULL DEFAULT '[]',
    "inputHash" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedTextHash" TEXT,
    "templateVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_assessment_scope" ON "opportunity_assessments"("id", "workspaceId");
CREATE INDEX "opportunity_assessments_workspaceId_opportunityId_profileId_createdAt_idx" ON "opportunity_assessments"("workspaceId", "opportunityId", "profileId", "createdAt");
CREATE INDEX "opportunity_drafts_workspaceId_opportunityId_createdAt_idx" ON "opportunity_drafts"("workspaceId", "opportunityId", "createdAt");

-- AddForeignKey (composite: a reference can never cross a workspace)
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_assessments" ADD CONSTRAINT "opportunity_assessments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_drafts" ADD CONSTRAINT "opportunity_drafts_opportunityId_workspaceId_fkey" FOREIGN KEY ("opportunityId", "workspaceId") REFERENCES "opportunities"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_drafts" ADD CONSTRAINT "opportunity_drafts_profileId_workspaceId_fkey" FOREIGN KEY ("profileId", "workspaceId") REFERENCES "opportunity_profiles"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_drafts" ADD CONSTRAINT "opportunity_drafts_assessmentId_workspaceId_fkey" FOREIGN KEY ("assessmentId", "workspaceId") REFERENCES "opportunity_assessments"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opportunity_drafts" ADD CONSTRAINT "opportunity_drafts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security: same model as every workspace table
ALTER TABLE "opportunity_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_assessments" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_assessments_isolation ON "opportunity_assessments" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_assessments"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));

ALTER TABLE "opportunity_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunity_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY opportunity_drafts_isolation ON "opportunity_drafts" USING (EXISTS (
 SELECT 1 FROM "workspace_members" wm WHERE wm."workspaceId" = "opportunity_drafts"."workspaceId"
 AND wm."userId" = current_setting('app.current_user_id', true)
));
