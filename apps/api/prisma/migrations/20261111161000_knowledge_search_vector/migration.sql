-- Задание 06 (Knowledge 2.0), п. 6.2: материализованный полнотекстовый вектор.
-- `searchVector` — tsvector (конфигурация russian) по названию, краткому содержанию и
-- телу. Обновляется триггером при любой записи (ORM, миграция, восстановление базы),
-- поэтому запрос поиска не пересчитывает to_tsvector на каждой строке.
-- Веса: A — название, B — краткое содержание, по умолчанию (D) — тело.

ALTER TABLE "knowledge_items" ADD COLUMN "searchVector" TSVECTOR;

UPDATE "knowledge_items" SET "searchVector" =
  setweight(to_tsvector('russian', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('russian', coalesce("summary", '')), 'B') ||
  to_tsvector('russian', coalesce("body", ''));

-- `UPDATE OF` — триггер пересчитывает вектор только когда меняются поля, из которых он собран.
CREATE OR REPLACE FUNCTION "knowledge_items_search_vector_update"() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('russian', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('russian', coalesce(NEW."summary", '')), 'B') ||
    to_tsvector('russian', coalesce(NEW."body", ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "knowledge_items_search_vector_trigger"
  BEFORE INSERT OR UPDATE OF "title", "summary", "body" ON "knowledge_items"
  FOR EACH ROW EXECUTE FUNCTION "knowledge_items_search_vector_update"();

CREATE INDEX "knowledge_items_search_vector_idx" ON "knowledge_items" USING GIN ("searchVector");
