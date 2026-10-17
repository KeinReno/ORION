import { z } from "zod";
import { categoryBreakdownEntrySchema } from "./finance";

/**
 * Plugin `finance-project-costs`: what one project cost, from the operations booked to it
 * (`Transaction.projectId`). Read-only aggregate. Transfers never count (they move money between own
 * accounts); amounts are kopecks and sums are exact — computed by the server, not from a loaded page.
 * Currencies are never added together and never converted: every sum is per account currency (`byCurrency`), and the
 * top-level `income`/`expense` are those of `currency` alone.
 */
export const projectCostTotalsSchema = z.object({
  currency: z.string(),
  income: z.number().int(),
  expense: z.number().int(),
  /** Income and expense operations in this currency. */
  operationCount: z.number().int()
});
export type ProjectCostTotals = z.infer<typeof projectCostTotalsSchema>;

export const projectCostsSchema = z.object({
  projectId: z.string(),
  /** Income of `currency` only (0 without operations). */
  income: z.number().int(),
  /** Expense of `currency` only (0 without operations). */
  expense: z.number().int(),
  /** Income and expense operations only, every currency (a count, not money). */
  operationCount: z.number().int(),
  /** Expense by (category, currency), currency by currency, largest first; `categoryId: null` is «Без категории». */
  expenseByCategory: z.array(categoryBreakdownEntrySchema),
  /** One entry per account currency of the project's operations; `currency` first, the rest alphabetical. */
  byCurrency: z.array(projectCostTotalsSchema),
  /** More than one account currency among the project's operations — see `byCurrency` for each one. */
  mixedCurrencies: z.boolean(),
  /**
   * The currency the top-level sums are in: the project's own `Project.currency` when it has operations in it,
   * otherwise the one with the most operations (ties alphabetical). Null only when there are no operations.
   */
  currency: z.string().nullable()
});
export type ProjectCosts = z.infer<typeof projectCostsSchema>;

/** Balance of the project in kopecks: income minus expense (negative = the project is in the red). */
export function projectCostBalance(costs: Pick<ProjectCosts, "income" | "expense">): number {
  return costs.income - costs.expense;
}
