ALTER TABLE "user_preferences" ADD COLUMN "customTheme" JSONB, ADD COLUMN "customThemeEnabled" BOOLEAN NOT NULL DEFAULT false;
