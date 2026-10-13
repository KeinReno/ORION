-- Plugin «Покупки → Склад» (lists-inventory): a shopping-list item can point at
-- the stock item it restocks, carry a quantity, and remember the receipt its
-- purchase created (unique → one receipt per list item, re-ticking never
-- restocks twice). No new table, so RLS is unchanged: list_items already has
-- ENABLE/FORCE ROW LEVEL SECURITY and its workspace policy.
ALTER TABLE "list_items" ADD COLUMN "inventoryItemId" TEXT;
ALTER TABLE "list_items" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "list_items" ADD COLUMN "stockedMovementId" TEXT;

CREATE UNIQUE INDEX "list_items_stockedMovementId_key" ON "list_items"("stockedMovementId");
CREATE INDEX "list_items_inventoryItemId_idx" ON "list_items"("inventoryItemId");

ALTER TABLE "list_items" ADD CONSTRAINT "list_items_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_stockedMovementId_fkey"
  FOREIGN KEY ("stockedMovementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "list_items" ADD CONSTRAINT "list_items_quantity_positive" CHECK ("quantity" > 0);
