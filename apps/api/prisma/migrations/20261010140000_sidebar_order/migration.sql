-- Personal order of the sidebar sections (view state, per user). JSONB with an empty default so existing rows are valid.
ALTER TABLE "user_preferences" ADD COLUMN "sidebarOrder" JSONB NOT NULL DEFAULT '[]'::jsonb;
