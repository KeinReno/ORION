-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "backgroundStyle" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "user_preferences" ADD COLUMN "backgroundIntensity" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "user_preferences" ADD COLUMN "surfaceStyle" TEXT NOT NULL DEFAULT 'solid';
