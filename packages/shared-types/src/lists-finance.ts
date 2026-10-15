import { z } from "zod";
import { listItemSchema } from "./list";

/**
 * Plugin «Покупки → Финансы» (`lists-finance`) — a Module Bridge between «Списки» and «Финансы»
 * (ADR-0009, the step after «Покупки → Склад»): the entries bought at one till become ONE expense.
 *
 * Why one transaction for several entries: a receipt is one payment, so booking each line separately
 * would either invent per-line splits or double the total. The entries remember the transaction
 * (`ListItem.expenseTransactionId`); an entry that already carries one is refused (409), which is what
 * keeps a sum from being booked twice — also under a race between two windows.
 */
export const recordListExpenseInputSchema = z.object({
  /** The bought entries of this list that make up the payment (they get ticked as well). */
  itemIds: z.array(z.string().min(1)).min(1, "Выберите пункты").max(200),
  /** The account the money left from. */
  accountId: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  /** Total in minor units. Omitted = the sum of the entries' prices (rejected if any price is unknown). */
  amountMinor: z.number().int().positive("Сумма должна быть больше нуля").max(2_000_000_000).optional(),
  occurredAt: z.string().datetime().optional(),
  note: z.string().max(500).optional()
});
export type RecordListExpenseInput = z.infer<typeof recordListExpenseInputSchema>;

export const recordListExpenseResultSchema = z.object({
  transactionId: z.string(),
  amountMinor: z.number().int(),
  items: z.array(listItemSchema)
});
export type RecordListExpenseResult = z.infer<typeof recordListExpenseResultSchema>;
