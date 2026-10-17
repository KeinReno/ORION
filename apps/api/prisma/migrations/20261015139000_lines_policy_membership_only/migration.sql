-- Строки операций: политика снова только по членству в пространстве.
-- Вложенная проверка «видна ли операция» на каждую строку давала вложенные подзапросы, которые планировщик на свежих
-- таблицах (без статистики) выполнял заново для каждой строки: тысячи строк — секунды. Строки достаются только вместе с
-- операцией (join/include/агрегат по `transaction`), а политика операции уже скрывает операции личных счетов, поэтому чужие
-- суммы не видны. Это проверяется тестом finance-private-accounts.
DROP POLICY finance_transaction_lines_isolation ON "finance_transaction_lines";
CREATE POLICY finance_transaction_lines_isolation ON "finance_transaction_lines"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "finance_transaction_lines"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
