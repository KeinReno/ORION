-- Row Level Security for the v0.20 «Склад» tables.
--
-- Both carry a denormalised `workspaceId` (inventory_movements too, even
-- though it could be reached through its item) so the policy is the same
-- flat membership check as every other workspace-owned table, and
-- inventory_movements is protected even when queried directly. The
-- structural integration test asserts ENABLE + FORCE + a policy for every
-- table with a "workspaceId", so this file is mandatory, not optional.

ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_items_isolation ON "inventory_items"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "inventory_items"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movements_isolation ON "inventory_movements"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "inventory_movements"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
