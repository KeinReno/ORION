-- Личные счета: счёт (и всё, что на нём) виден только владельцу. Это правило базы (RLS), а не кода.
ALTER TABLE "finance_accounts" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "finance_accounts" ADD COLUMN "ownerId" TEXT;

-- «Этот счёт мне виден». Функция НЕ security definer: подзапрос к finance_accounts идёт под RLS вызывающего,
-- поэтому чужой личный счёт для него «не существует», а свои политики остаются в одном месте.
CREATE FUNCTION orion_account_visible(account_id TEXT) RETURNS BOOLEAN
  LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."id" = account_id) $$;

DROP POLICY finance_accounts_isolation ON "finance_accounts";
CREATE POLICY finance_accounts_isolation ON "finance_accounts"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_accounts"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND (
      "visibility" = 'workspace'
      OR "ownerId" = current_setting('app.current_user_id', true)
      -- Владелец ушёл из пространства: личный счёт не пропадает навсегда, а снова виден участникам.
      OR NOT EXISTS (
        SELECT 1 FROM "workspace_members" o
        WHERE o."workspaceId" = "finance_accounts"."workspaceId" AND o."userId" = "finance_accounts"."ownerId"
      )
    )
  );

-- Операция видна, если виден счёт-источник ИЛИ счёт назначения (перевод с общего на личный виден всем, у кого виден общий:
-- иначе остаток общего счёта у них посчитался бы неверно).
DROP POLICY finance_transactions_isolation ON "finance_transactions";
CREATE POLICY finance_transactions_isolation ON "finance_transactions"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_transactions"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND (orion_account_visible("accountId") OR orion_account_visible("toAccountId"))
  );

-- Строки операции видны вместе с операцией (сама операция уже отфильтрована политикой выше).
DROP POLICY finance_transaction_lines_isolation ON "finance_transaction_lines";
CREATE POLICY finance_transaction_lines_isolation ON "finance_transaction_lines"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_transaction_lines"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND EXISTS (SELECT 1 FROM "finance_transactions" t WHERE t."id" = "finance_transaction_lines"."transactionId")
  );

DROP POLICY finance_recurring_transactions_isolation ON "finance_recurring_transactions";
CREATE POLICY finance_recurring_transactions_isolation ON "finance_recurring_transactions"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_recurring_transactions"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND orion_account_visible("accountId")
  );

DROP POLICY finance_savings_goals_isolation ON "finance_savings_goals";
CREATE POLICY finance_savings_goals_isolation ON "finance_savings_goals"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_savings_goals"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND orion_account_visible("accountId")
  );

DROP POLICY finance_obligations_isolation ON "finance_obligations";
CREATE POLICY finance_obligations_isolation ON "finance_obligations"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_obligations"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND ("accountId" IS NULL OR orion_account_visible("accountId"))
  );
