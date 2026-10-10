-- Which edge the menu sits on (view state, per user). Existing rows keep the classic left rail.
ALTER TABLE "user_preferences" ADD COLUMN "sidebarPosition" TEXT NOT NULL DEFAULT 'left';
