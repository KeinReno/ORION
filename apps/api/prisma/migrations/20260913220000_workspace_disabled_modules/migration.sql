-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "disabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
