import { z } from "zod";
import { inventoryMovementSchema } from "./inventory";
import { listItemSchema } from "./list";

/**
 * Plugin «Покупки → Склад» (`lists-inventory`) — a Module Bridge between
 * «Списки» and «Склад» (PRODUCT_DIRECTION.md: «список покупок → покупка →
 * имущество»). It extends Lists and needs Inventory on as well; with either
 * switched off the server answers 409 and the UI hides its parts.
 *
 * A link never copies data: the list entry stores only `inventoryItemId` and a
 * quantity; buying it writes one ordinary inventory receipt (the ledger stays
 * the single source of the balance) and remembers it, so the same entry never
 * restocks twice.
 */

export const linkListItemInventoryInputSchema = z.object({
  /** `null` removes the link (an already-written receipt stays in the ledger). */
  inventoryItemId: z.string().min(1).nullable(),
  quantity: z.number().int().min(1, "Количество должно быть больше нуля").max(100_000).optional()
});
export type LinkListItemInventoryInput = z.infer<typeof linkListItemInventoryInputSchema>;

export const purchaseListItemResultSchema = z.object({
  item: listItemSchema,
  /** The receipt this purchase wrote; `null` when the entry had already been stocked earlier. */
  movement: inventoryMovementSchema.nullable()
});
export type PurchaseListItemResult = z.infer<typeof purchaseListItemResultSchema>;

export const addInventoryToListInputSchema = z.object({
  listId: z.string().min(1),
  /** Defaults to what brings the balance back above the low-stock threshold, at least 1. */
  quantity: z.number().int().min(1).max(100_000).optional()
});
export type AddInventoryToListInput = z.infer<typeof addInventoryToListInputSchema>;

/** Units to buy so the balance ends strictly above `minStock`; 1 when there is no threshold or stock is fine. */
export function restockQuantity(balance: number, minStock: number | null): number {
  if (minStock === null) return 1;
  return Math.max(1, minStock + 1 - balance);
}
