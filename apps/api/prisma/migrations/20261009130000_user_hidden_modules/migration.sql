-- Personal module hiding: a user hides a module from THEIR own navigation.
-- Purely a view preference — the module stays enabled for the workspace and no
-- data is touched (the owner's `disabledModules` is the real on/off switch).
ALTER TABLE "user_preferences" ADD COLUMN "hiddenModules" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "user_preferences" SET "hiddenModules" = ARRAY[]::TEXT[] WHERE "hiddenModules" IS NULL;
ALTER TABLE "user_preferences" ALTER COLUMN "hiddenModules" SET NOT NULL;
