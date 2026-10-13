-- Global goals and their plans (plugin projects-goals).
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "goals_workspaceId_idx" ON "goals"("workspaceId");
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "goal_plans" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "goal_plans_goalId_projectId_key" ON "goal_plans"("goalId", "projectId");
CREATE INDEX "goal_plans_workspaceId_idx" ON "goal_plans"("workspaceId");
CREATE INDEX "goal_plans_projectId_idx" ON "goal_plans"("projectId");
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plans_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plans_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_plans" ADD CONSTRAINT "goal_plans_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every table with "workspaceId" needs ENABLE + FORCE RLS and a policy.
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;
CREATE POLICY goals_isolation ON "goals"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "goals"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "goal_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_plans_isolation ON "goal_plans"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "goal_plans"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
