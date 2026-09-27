-- ORION v0.9 "Заметки" phase 5 — note templates. A template is an ordinary
-- note with this flag; NotesService keeps flagged rows out of the normal
-- list, "Новая из шаблона" copies their body/tags into a fresh note.
ALTER TABLE "notes" ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false;
