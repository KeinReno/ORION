-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "backgroundColor" TEXT,
ADD COLUMN     "backgroundDensity" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "backgroundSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "targetCursorEnabled" BOOLEAN NOT NULL DEFAULT false;
