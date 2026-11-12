-- Задание 06 (Knowledge 2.0), п. 6.2: приведение текста к нижнему регистру при сборке
-- вектора. База создаётся с локалью C и UTF8: `to_tsvector('russian', …)` там сохраняет
-- заглавные кириллические буквы как отдельные лексемы ('Договор' ≠ 'договор'), и поиск
-- в нижнем регистре не находил бы материалы с заглавной буквы. `lower()` в этой сборке
-- Юникод-корректен (проверено на 'Договор Аренды' → 'договор аренды').
-- Триггер не пересоздаётся: он вызывает эту же функцию.

CREATE OR REPLACE FUNCTION "knowledge_items_search_vector_update"() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('russian', lower(coalesce(NEW."title", ''))), 'A') ||
    setweight(to_tsvector('russian', lower(coalesce(NEW."summary", ''))), 'B') ||
    to_tsvector('russian', lower(coalesce(NEW."body", '')));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Пересобрать векторы существующих материалов (триггер не срабатывает: меняется только searchVector).
UPDATE "knowledge_items" SET "searchVector" =
  setweight(to_tsvector('russian', lower(coalesce("title", ''))), 'A') ||
  setweight(to_tsvector('russian', lower(coalesce("summary", ''))), 'B') ||
  to_tsvector('russian', lower(coalesce("body", '')));
