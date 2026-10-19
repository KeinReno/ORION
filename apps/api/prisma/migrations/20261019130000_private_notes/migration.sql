-- G21 (ADR-0021): личные заметки внутри общего пространства. Заметку с privateToUserId видит и меняет только этот пользователь.
ALTER TABLE "notes" ADD COLUMN "privateToUserId" TEXT;
CREATE INDEX "notes_privateToUserId_idx" ON "notes"("privateToUserId");
ALTER TABLE "notes" ADD CONSTRAINT "notes_privateToUserId_fkey" FOREIGN KEY ("privateToUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICTIVE: условие складывается со всеми разрешающими политиками (членство, выданный доступ) через И, поэтому
-- ни членство в пространстве, ни владелец пространства, ни cross-workspace доступ не открывают чужую личную заметку.
-- orion_system (BYPASSRLS) остаётся для фоновых задач: чистка корзины должна видеть и личные заметки.
CREATE POLICY notes_private_owner ON "notes"
  AS RESTRICTIVE
  USING ("privateToUserId" IS NULL OR "privateToUserId" = current_setting('app.current_user_id', true))
  WITH CHECK ("privateToUserId" IS NULL OR "privateToUserId" = current_setting('app.current_user_id', true));

-- Номер заметки назначается по MAX в пространстве: функция должна видеть и личные заметки других (иначе два участника
-- получат один номер и вставка упадёт на уникальном индексе). SECURITY DEFINER выполняет её от владельца таблицы, а
-- не от ограниченной роли приложения; утекают только номера, не содержимое.
CREATE OR REPLACE FUNCTION "notes_assign_number"() RETURNS trigger AS $$
BEGIN
  IF NEW."number" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('notes_number:' || NEW."workspaceId"));
    SELECT COALESCE(MAX("number"), 0) + 1 INTO NEW."number" FROM "notes" WHERE "workspaceId" = NEW."workspaceId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
