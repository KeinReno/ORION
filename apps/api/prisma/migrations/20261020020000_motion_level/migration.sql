-- How much the interface animates (off | calm | expressive), per user. Existing rows get the calm default.
ALTER TABLE "user_preferences" ADD COLUMN "motionLevel" TEXT NOT NULL DEFAULT 'calm';
