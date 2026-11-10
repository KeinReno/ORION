-- Stable agent personas, their explicit AI Bridge credential bindings, and the current task executor.
CREATE TABLE "agent_hub_agent_profiles" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_hub_agent_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_hub_agent_profiles_workspaceId_id_key" ON "agent_hub_agent_profiles"("workspaceId", "id");
CREATE UNIQUE INDEX "agent_hub_agent_profiles_workspaceId_name_key" ON "agent_hub_agent_profiles"("workspaceId", "name");
ALTER TABLE "agent_hub_agent_profiles" ADD CONSTRAINT "agent_hub_agent_profiles_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_hub_agent_credentials" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_hub_agent_credentials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_hub_agent_credentials_tokenId_key" ON "agent_hub_agent_credentials"("tokenId");
CREATE INDEX "agent_hub_agent_credentials_workspaceId_profileId_idx" ON "agent_hub_agent_credentials"("workspaceId", "profileId");
ALTER TABLE "agent_hub_agent_credentials" ADD CONSTRAINT "agent_hub_agent_credentials_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_hub_agent_credentials" ADD CONSTRAINT "agent_hub_agent_credentials_workspaceId_profileId_fkey"
  FOREIGN KEY ("workspaceId", "profileId") REFERENCES "agent_hub_agent_profiles"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_hub_task_assignments" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_hub_task_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_hub_task_assignments_workspaceId_taskId_key" ON "agent_hub_task_assignments"("workspaceId", "taskId");
CREATE INDEX "agent_hub_task_assignments_workspaceId_profileId_idx" ON "agent_hub_task_assignments"("workspaceId", "profileId");
ALTER TABLE "agent_hub_task_assignments" ADD CONSTRAINT "agent_hub_task_assignments_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_hub_task_assignments" ADD CONSTRAINT "agent_hub_task_assignments_workspaceId_profileId_fkey"
  FOREIGN KEY ("workspaceId", "profileId") REFERENCES "agent_hub_agent_profiles"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Assignments keep the task ID as a durable reference. They become unreadable current assignments
-- when their task is deleted (the API verifies through TaskIntegrationReader) and are preserved as history.
