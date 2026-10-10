-- Whether opening sections piles up tabs or replaces the current one (view state, per user). Existing rows keep piling up.
ALTER TABLE "user_preferences" ADD COLUMN "openTabsMode" TEXT NOT NULL DEFAULT 'accumulate';
