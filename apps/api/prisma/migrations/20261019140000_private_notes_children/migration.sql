-- G21 (ADR-0021): дочерние таблицы заметки не должны раскрывать личную заметку мимо самой заметки (в ревизиях лежит
-- её текст, во вложениях — файлы). Строка видна, только если видна родительская заметка: подзапрос выполняется с правами
-- того же пользователя, поэтому чужая личная заметка в нём «не существует». RESTRICTIVE складывается с членством через И.
CREATE POLICY note_revisions_private_parent ON "note_revisions" AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_revisions"."noteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_revisions"."noteId"));

CREATE POLICY note_attachments_private_parent ON "note_attachments" AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_attachments"."noteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_attachments"."noteId"));

CREATE POLICY note_links_private_source ON "note_links" AS RESTRICTIVE
  USING (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_links"."sourceNoteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "notes" n WHERE n."id" = "note_links"."sourceNoteId"));
