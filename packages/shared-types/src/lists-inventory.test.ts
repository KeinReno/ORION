import { describe, expect, it } from "vitest";
import { addInventoryToListInputSchema, linkListItemInventoryInputSchema, restockQuantity } from "./lists-inventory";

describe("lists-inventory bridge contract", () => {
  it("restocks just above the threshold, at least one unit", () => {
    expect(restockQuantity(0, 3)).toBe(4);
    expect(restockQuantity(2, 3)).toBe(2);
    expect(restockQuantity(3, 3)).toBe(1);
    expect(restockQuantity(10, 3)).toBe(1);
    expect(restockQuantity(0, null)).toBe(1);
  });

  it("accepts unlinking with null and rejects a non-positive quantity", () => {
    expect(linkListItemInventoryInputSchema.parse({ inventoryItemId: null })).toEqual({ inventoryItemId: null });
    expect(linkListItemInventoryInputSchema.safeParse({ inventoryItemId: "x", quantity: 0 }).success).toBe(false);
    expect(addInventoryToListInputSchema.safeParse({ listId: "" }).success).toBe(false);
  });
});
