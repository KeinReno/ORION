-- 11: снапшоты карты Architect по ревизиям. Зафиксированный результат анализа на коммите:
-- диффы по истории не пересчитывают старые ревизии заново. Запись — производное от кода,
-- а не источник истины; удаление снапшота на репозиторий не влияет.

CREATE TABLE "development_architect_snapshots" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "sha" TEXT NOT NULL,
  "nodes" JSONB NOT NULL DEFAULT '[]',
  "edges" JSONB NOT NULL DEFAULT '[]',
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "development_architect_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "development_architect_snapshots_workspaceId_repositoryId_sha_key"
  ON "development_architect_snapshots"("workspaceId", "repositoryId", "sha");
CREATE INDEX "development_architect_snapshots_workspaceId_repositoryId_createdAt_idx"
  ON "development_architect_snapshots"("workspaceId", "repositoryId", "createdAt");
ALTER TABLE "development_architect_snapshots" ADD CONSTRAINT "development_architect_snapshots_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
