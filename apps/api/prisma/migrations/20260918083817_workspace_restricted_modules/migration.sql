-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "restrictedModules" TEXT[] DEFAULT ARRAY[]::TEXT[];
