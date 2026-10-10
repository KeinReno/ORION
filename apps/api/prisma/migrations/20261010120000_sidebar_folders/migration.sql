-- Personal sidebar folders (view state, per user). JSONB with an empty default so existing rows are valid.
ALTER TABLE "user_preferences" ADD COLUMN "sidebarFolders" JSONB NOT NULL DEFAULT '[]'::jsonb;
