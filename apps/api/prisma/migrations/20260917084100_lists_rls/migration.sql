-- Row Level Security for the «Списки» tables.
--
-- Same flat membership-based policy as every other workspace-owned table
-- (see habits_rls for the identical pattern). `list_items` carries a
-- denormalised `workspaceId` too, so it's protected even when queried
-- directly, not only through its parent list. The structural integration
-- test asserts ENABLE + FORCE + a policy for every table with a
-- "workspaceId" column, so this migration is mandatory, not optional.

ALTER TABLE "lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY lists_isolation ON "lists"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "lists"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "list_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "list_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY list_items_isolation ON "list_items"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "list_items"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
