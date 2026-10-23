-- Библиотека базы знаний: тип материала, ревизия текста и ссылка источника на заметку или документ.

ALTER TABLE "knowledge_items" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'fact';
ALTER TABLE "knowledge_items" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "knowledge_sources" ADD COLUMN "noteId" TEXT;
ALTER TABLE "knowledge_sources" ADD COLUMN "documentId" TEXT;
