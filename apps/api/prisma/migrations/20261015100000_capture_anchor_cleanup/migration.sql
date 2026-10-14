-- Captures anchored to a task / goal / home / account / obligation / contact have no foreign key, so deleting
-- the anchor used to leave them behind, invisible. A trigger per anchor table removes them with the anchor
-- (every deletion path, including cascades). Projects keep their real FK (captures.projectId).
CREATE OR REPLACE FUNCTION captures_delete_with_anchor() RETURNS trigger AS $$
BEGIN
  DELETE FROM "captures" WHERE "anchorType" = TG_ARGV[0] AND "anchorId" = OLD."id";
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_captures_cleanup AFTER DELETE ON "tasks" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('task');
CREATE TRIGGER goals_captures_cleanup AFTER DELETE ON "goals" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('goal');
CREATE TRIGGER homes_captures_cleanup AFTER DELETE ON "homes" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('home');
CREATE TRIGGER accounts_captures_cleanup AFTER DELETE ON "finance_accounts" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('account');
CREATE TRIGGER obligations_captures_cleanup AFTER DELETE ON "finance_obligations" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('obligation');
CREATE TRIGGER contacts_captures_cleanup AFTER DELETE ON "contacts" FOR EACH ROW EXECUTE FUNCTION captures_delete_with_anchor('contact');

-- Captures already orphaned by earlier deletions.
DELETE FROM "captures" c WHERE c."anchorType" = 'task' AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."id" = c."anchorId");
DELETE FROM "captures" c WHERE c."anchorType" = 'goal' AND NOT EXISTS (SELECT 1 FROM "goals" t WHERE t."id" = c."anchorId");
DELETE FROM "captures" c WHERE c."anchorType" = 'home' AND NOT EXISTS (SELECT 1 FROM "homes" t WHERE t."id" = c."anchorId");
DELETE FROM "captures" c WHERE c."anchorType" = 'account' AND NOT EXISTS (SELECT 1 FROM "finance_accounts" t WHERE t."id" = c."anchorId");
DELETE FROM "captures" c WHERE c."anchorType" = 'obligation' AND NOT EXISTS (SELECT 1 FROM "finance_obligations" t WHERE t."id" = c."anchorId");
DELETE FROM "captures" c WHERE c."anchorType" = 'contact' AND NOT EXISTS (SELECT 1 FROM "contacts" t WHERE t."id" = c."anchorId");
