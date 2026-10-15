import { z } from "zod";
import { categoryBreakdownEntrySchema } from "./finance";

/**
 * Plugin `finance-project-costs`: what one project cost, from the operations booked to it
 * (`Transaction.projectId`). Read-only aggregate. Transfers never count (they move money between own
 * accounts); amounts are kopecks and sums are exact — computed by the server, not from a loaded page.
 * Currencies are not converted: a project booked in several account currencies is reported as `mixedCurrencies`.
 */
export const projectCostsSchema = z.object({
  projectId: z.string(),
  income: z.number().int(),
  expense: z.number().int(),
  /** Income and expense operations only. */
  operationCount: z.number().int(),
  /** Expense by category, largest first; `categoryId: null` is «Без категории». */
  expenseByCategory: z.array(categoryBreakdownEntrySchema),
  /** More than one account currency among the project's operations: the sums above add up different currencies. */
  mixedCurrencies: z.boolean(),
  currency: z.string().nullable()
});
export type ProjectCosts = z.infer<typeof projectCostsSchema>;

/** Balance of the project in kopecks: income minus expense (negative = the project is in the red). */
export function projectCostBalance(costs: Pick<ProjectCosts, "income" | "expense">): number {
  return costs.income - costs.expense;
}
