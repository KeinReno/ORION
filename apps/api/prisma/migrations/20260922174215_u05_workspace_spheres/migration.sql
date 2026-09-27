-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "favoriteWorkspaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "spheres" JSONB NOT NULL DEFAULT '[]';
