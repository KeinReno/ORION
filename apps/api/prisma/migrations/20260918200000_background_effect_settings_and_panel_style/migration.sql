-- AlterTable
ALTER TABLE "user_preferences" DROP COLUMN "backgroundColor",
DROP COLUMN "backgroundDensity",
DROP COLUMN "backgroundSpeed",
ADD COLUMN     "backgroundEffectSettings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "panelAccent" TEXT,
ADD COLUMN     "panelBlur" INTEGER NOT NULL DEFAULT 16,
ADD COLUMN     "panelOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.6;
