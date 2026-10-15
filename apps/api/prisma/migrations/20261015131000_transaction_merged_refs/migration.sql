-- Плагин «Сопоставление переводов»: ссылки импорта поглощённых строк хранятся в переводе, чтобы повторный импорт не создал их заново.
-- Таблица уже под RLS — политики не меняются.
ALTER TABLE "finance_transactions" ADD COLUMN "mergedRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
