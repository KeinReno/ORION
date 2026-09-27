-- CreateTable
CREATE TABLE "cross_workspace_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "granterId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'full',
    "projectionFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "cross_workspace_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cross_workspace_grants_workspaceId_idx" ON "cross_workspace_grants"("workspaceId");

-- CreateIndex
CREATE INDEX "cross_workspace_grants_granteeUserId_objectType_objectId_idx" ON "cross_workspace_grants"("granteeUserId", "objectType", "objectId");
