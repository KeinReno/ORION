import { z } from "zod";

/**
 * ORION v0.26 «Склад» — see docs/HISTORY.md.
 *
 * `InventoryItem.balance` and `avgCostMinor` are never stored — they're a sum
 * over `InventoryMovement` rows, computed by `InventoryService` for every item
 * at once (same trick as `Account.balance`, see finance/accounts). One fewer
 * place for the truth to drift.
 *
 * `avgCostMinor` is a simplified weighted average across every receipt ever
 * (`SUM(qty*cost)/SUM(qty)` over `type = "receipt"` rows with a cost), not a
 * true moving-average-at-time-of-issue — a deliberate v0.26 simplification
 * that keeps it a pure aggregate instead of stateful history-dependent value.
 */

export const inventoryMovementTypeSchema = z.enum(["receipt", "issue", "adjustment"]);
export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>;

export const inventoryItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  minStock: z.number().int().nullable(),
  /** Never null once a receipt with a cost has landed — see the file comment. */
  balance: z.number().int(),
  avgCostMinor: z.number().int().nullable(),
  /** `balance <= minStock` (with `minStock` set) — the panel's low-stock badge, computed once here rather than re-derived client-side. */
  lowStock: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const createInventoryItemInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(200),
  sku: z.string().trim().max(80).nullable().optional(),
  unit: z.string().trim().min(1).max(20).default("шт"),
  minStock: z.number().int().min(0).nullable().optional(),
  projectId: z.string().nullable().optional()
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemInputSchema>;

export const updateInventoryItemInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().max(80).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  minStock: z.number().int().min(0).nullable().optional(),
  projectId: z.string().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemInputSchema>;

export const inventoryMovementSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  itemId: z.string(),
  type: inventoryMovementTypeSchema,
  /** Signed delta — positive for a receipt, negative for an issue, either sign for an adjustment. */
  quantity: z.number().int(),
  unitCostMinor: z.number().int().nullable(),
  note: z.string(),
  createdAt: z.string()
});
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;

/**
 * Input's `quantity` is always a positive count — the sign is derived from
 * `type` server-side (see InventoryService.recordMovement), so the form never
 * has to ask "do I send this negative?". `adjustment` is the one type where
 * the caller says the direction explicitly via `direction`.
 */
export const createInventoryMovementInputSchema = z.object({
  type: inventoryMovementTypeSchema,
  quantity: z.number().int().positive("Количество должно быть больше нуля"),
  /** Only meaningful for `type: "adjustment"` — ignored otherwise (receipt is always "+", issue is always "-"). */
  direction: z.enum(["+", "-"]).default("+"),
  /** Only meaningful for `type: "receipt"`. */
  unitCostMinor: z.number().int().min(0).nullable().optional(),
  note: z.string().trim().max(2_000).default("")
});
export type CreateInventoryMovementInput = z.infer<typeof createInventoryMovementInputSchema>;
