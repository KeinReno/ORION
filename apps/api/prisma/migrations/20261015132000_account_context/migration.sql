-- «Финансы»: чьи это деньги — личные, семейные или рабочие (метка счёта для фильтра и итогов).
-- Таблица уже под RLS — политики не меняются.
ALTER TABLE "finance_accounts" ADD COLUMN "context" TEXT NOT NULL DEFAULT 'personal';
