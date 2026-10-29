-- ORION-06: per-user rebound shortcuts (view state, like sidebarFolders). Empty default so existing rows stay valid.
ALTER TABLE "user_preferences" ADD COLUMN "shortcutOverrides" JSONB NOT NULL DEFAULT '{}'::jsonb;
