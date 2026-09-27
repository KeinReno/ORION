-- R18-01: durable two-phase restore operation tracking + per-workspace lock.
-- See SyncRestoreOperation doc comment in schema.prisma.
CREATE TABLE "sync_restore_operations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_restore_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_restore_operations_workspaceId_key" ON "sync_restore_operations"("workspaceId");
