-- 12 — Architect: authored software architecture diagrams (separate from repository maps/workflows).
CREATE TABLE "development_architecture_diagrams" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "nodes" JSONB NOT NULL DEFAULT '[]',
  "edges" JSONB NOT NULL DEFAULT '[]',
  "viewport" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "development_architecture_diagrams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "development_architecture_diagrams_revision_check" CHECK ("revision" > 0)
);

CREATE INDEX "development_architecture_diagrams_workspaceId_updatedAt_idx"
  ON "development_architecture_diagrams"("workspaceId", "updatedAt");

ALTER TABLE "development_architecture_diagrams"
  ADD CONSTRAINT "development_architecture_diagrams_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "development_architecture_diagrams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_architecture_diagrams" FORCE ROW LEVEL SECURITY;

CREATE POLICY development_architecture_diagrams_isolation
  ON "development_architecture_diagrams"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_architecture_diagrams"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "development_architecture_diagrams"."workspaceId"
      AND wm."userId" = NULLIF(current_setting('app.current_user_id', true), '')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "development_architecture_diagrams" TO orion_app, orion_system;
