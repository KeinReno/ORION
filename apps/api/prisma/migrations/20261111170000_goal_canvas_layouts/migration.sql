-- 08.1: server-side constellation canvas. One row per root goal; entries/zones are a
-- presentation layout over existing entities, never a copy. Conflicts keep both versions.
CREATE TABLE "goal_canvas_layouts" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "entries" JSONB NOT NULL DEFAULT '[]',
  "viewport" JSONB NOT NULL DEFAULT '{}',
  "zones" JSONB NOT NULL DEFAULT '[]',
  "conflicts" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "goal_canvas_layouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "goal_canvas_layouts_goalId_key" ON "goal_canvas_layouts"("goalId");
CREATE INDEX "goal_canvas_layouts_workspaceId_idx" ON "goal_canvas_layouts"("workspaceId");
ALTER TABLE "goal_canvas_layouts" ADD CONSTRAINT "goal_canvas_layouts_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_canvas_layouts" ADD CONSTRAINT "goal_canvas_layouts_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (same membership policy as every workspace table).
ALTER TABLE "goal_canvas_layouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_canvas_layouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_canvas_layouts_isolation ON "goal_canvas_layouts"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "goal_canvas_layouts"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
