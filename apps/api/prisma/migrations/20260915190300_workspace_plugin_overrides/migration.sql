-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "pluginOverrides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
