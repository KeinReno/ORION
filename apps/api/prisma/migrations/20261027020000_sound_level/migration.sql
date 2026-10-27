-- How much the interface sounds (off | quiet | full), per user. Opt-in: existing rows get "off".
ALTER TABLE "user_preferences" ADD COLUMN "soundLevel" TEXT NOT NULL DEFAULT 'off';
