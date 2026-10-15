-- Личные счета: политики без функции orion_account_visible.
-- Функция не встраивалась планировщиком и считалась «дорогой», из-за чего подзапрос по операциям выполнялся заново для
-- каждой строки отчёта (квадратичная работа: 550 операций → десятки секунд). Прямой EXISTS по первичному ключу счёта —
-- один дешёвый индексный поиск, и подзапрос снова считается один раз.

DROP POLICY finance_transactions_isolation ON "finance_transactions";
CREATE POLICY finance_transactions_isolation ON "finance_transactions"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_transactions"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND (
      EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."id" = "finance_transactions"."accountId")
      OR EXISTS (SELECT 1 FROM "finance_accounts" a2 WHERE a2."id" = "finance_transactions"."toAccountId")
    )
  );

DROP POLICY finance_recurring_transactions_isolation ON "finance_recurring_transactions";
CREATE POLICY finance_recurring_transactions_isolation ON "finance_recurring_transactions"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_recurring_transactions"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."id" = "finance_recurring_transactions"."accountId")
  );

DROP POLICY finance_savings_goals_isolation ON "finance_savings_goals";
CREATE POLICY finance_savings_goals_isolation ON "finance_savings_goals"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_savings_goals"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."id" = "finance_savings_goals"."accountId")
  );

DROP POLICY finance_obligations_isolation ON "finance_obligations";
CREATE POLICY finance_obligations_isolation ON "finance_obligations"
  USING (
    EXISTS (
      SELECT 1 FROM "workspace_members" wm
      WHERE wm."workspaceId" = "finance_obligations"."workspaceId"
        AND wm."userId" = current_setting('app.current_user_id', true)
    )
    AND (
      "accountId" IS NULL
      OR EXISTS (SELECT 1 FROM "finance_accounts" a WHERE a."id" = "finance_obligations"."accountId")
    )
  );

DROP FUNCTION orion_account_visible(TEXT);
