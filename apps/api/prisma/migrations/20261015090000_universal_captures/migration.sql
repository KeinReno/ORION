-- Universal Capture: an idea / problem / note anchored to any ORION object or to nothing.
-- Replaces project_captures; existing rows are copied with the same ids (anchor = their project).
CREATE TYPE "CaptureKind" AS ENUM ('idea', 'problem', 'note');
CREATE TYPE "CaptureStatus" AS ENUM ('open', 'promoted', 'dismissed');
CREATE TYPE "CaptureSeverity" AS ENUM ('annoyance', 'bug', 'fix');

CREATE TABLE "captures" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "anchorType" TEXT,
    "anchorId" TEXT,
    "projectId" TEXT,
    "kind" "CaptureKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "CaptureStatus" NOT NULL DEFAULT 'open',
    "severity" "CaptureSeverity",
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "captures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "captures_anchor_pair" CHECK (("anchorType" IS NULL) = ("anchorId" IS NULL))
);

CREATE INDEX "captures_workspaceId_idx" ON "captures"("workspaceId");
CREATE INDEX "captures_workspaceId_anchorType_anchorId_kind_idx" ON "captures"("workspaceId", "anchorType", "anchorId", "kind");
CREATE INDEX "captures_projectId_kind_idx" ON "captures"("projectId", "kind");
CREATE INDEX "captures_taskId_idx" ON "captures"("taskId");

ALTER TABLE "captures" ADD CONSTRAINT "captures_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "captures" ADD CONSTRAINT "captures_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "captures" ADD CONSTRAINT "captures_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "captures" FORCE ROW LEVEL SECURITY;
CREATE POLICY captures_isolation ON "captures"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "captures"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

-- Existing project ideas / problems keep their ids. The migration role bypasses RLS,
-- so the copy sees every workspace.
INSERT INTO "captures" ("id", "workspaceId", "anchorType", "anchorId", "projectId", "kind", "title", "body", "status", "severity", "taskId", "createdAt", "updatedAt")
SELECT "id", "workspaceId", 'project', "projectId", "projectId",
       "kind"::text::"CaptureKind", "title", "body", "status"::text::"CaptureStatus",
       "severity"::text::"CaptureSeverity", "taskId", "createdAt", "updatedAt"
FROM "project_captures";

DROP TABLE "project_captures";
DROP TYPE "ProjectCaptureKind";
DROP TYPE "ProjectCaptureStatus";
DROP TYPE "ProjectCaptureSeverity";
