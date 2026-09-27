-- ORION — синхронизация/бэкап через облако (WebDAV), Стадия 1.
-- Одна настроенная удалёнка на рабочее пространство на этом узле.
-- Разбор и архитектура — docs/SYNC.md.

-- CreateTable
CREATE TABLE "sync_remotes" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'webdav',
    "url" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "passwordEnc" TEXT NOT NULL DEFAULT '',
    "baseDir" TEXT NOT NULL DEFAULT '/ORION',
    "depthInfinity" BOOLEAN NOT NULL DEFAULT true,
    "encAlgo" TEXT NOT NULL DEFAULT 'rclone-base64',
    "autoEveryMs" INTEGER NOT NULL DEFAULT -1,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_remotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_remotes_workspaceId_key" ON "sync_remotes"("workspaceId");

-- CreateIndex
CREATE INDEX "sync_remotes_workspaceId_idx" ON "sync_remotes"("workspaceId");

-- AddForeignKey
ALTER TABLE "sync_remotes" ADD CONSTRAINT "sync_remotes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
