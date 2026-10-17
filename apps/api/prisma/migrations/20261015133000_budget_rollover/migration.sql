-- Плагин «Бюджеты»: перенос неизрасходованного остатка на следующий месяц (режим «конвертов»).
-- Таблица уже под RLS — политики не меняются.
ALTER TABLE "finance_budgets" ADD COLUMN "rollover" BOOLEAN NOT NULL DEFAULT false;
