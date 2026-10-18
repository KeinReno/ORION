-- Theme library: several own palettes per account, an explicit active choice and a per-workspace palette.
ALTER TABLE "user_preferences"
  ADD COLUMN "themeLibrary" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "activeThemeId" TEXT,
  ADD COLUMN "workspaceThemeMode" TEXT NOT NULL DEFAULT 'follow';

-- Carry the single saved palette into the library so nobody loses it. An imported theme could carry a built-in
-- preset id; it is renamed so the preset and the own copy stay distinguishable.
WITH legacy AS (
  SELECT "id",
         CASE WHEN "customTheme"->>'id' IN ('kaiden-precision', 'obsidian', 'midnight', 'emerald', 'crimson', 'arctic')
              THEN jsonb_set("customTheme", '{id}', to_jsonb('custom-' || ("customTheme"->>'id')))
              ELSE "customTheme" END AS doc
  FROM "user_preferences"
  WHERE "customTheme" IS NOT NULL AND jsonb_typeof("customTheme") = 'object' AND "customTheme" ? 'id'
)
UPDATE "user_preferences" p
SET "themeLibrary" = jsonb_build_array(jsonb_build_object(
      'document', legacy.doc,
      'updatedAt', to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))),
    "activeThemeId" = CASE WHEN p."customThemeEnabled" THEN legacy.doc->>'id' ELSE NULL END
FROM legacy
WHERE p."id" = legacy."id";

ALTER TABLE "workspaces" ADD COLUMN "theme" JSONB;
