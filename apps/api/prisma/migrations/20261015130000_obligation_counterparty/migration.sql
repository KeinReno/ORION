-- «Обязательства»: с кем долг (свободный текст). Таблица уже под RLS — политики не меняются.
ALTER TABLE "finance_obligations" ADD COLUMN "counterparty" TEXT NOT NULL DEFAULT '';
