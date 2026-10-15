import { z } from "zod";
import type { Transaction } from "./finance";

/**
 * Plugin `finance-transfer-match`: two statements of the user's own accounts show one transfer twice — as an expense in
 * one account and as an income in the other. This finds such pairs and (server side) merges a pair into ONE transfer.
 *
 * The same predicate runs on both sides: the client proposes, the server re-checks before it deletes anything.
 */
export const TRANSFER_MATCH_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

export const mergeTransferInputSchema = z.object({
  expenseId: z.string(),
  incomeId: z.string()
});
export type MergeTransferInput = z.infer<typeof mergeTransferInputSchema>;

type PairSide = Pick<Transaction, "id" | "type" | "accountId" | "totalAmount" | "occurredAt" | "importedRef"> & { lines: readonly unknown[] };

/** Operations written by «Оплатить» in Обязательства are real payments, never one half of a transfer. */
function isPlainOperation(transaction: PairSide): boolean {
  return transaction.lines.length === 1 && !transaction.importedRef?.startsWith("obligation:");
}

/** An expense and an income that look like the two halves of one transfer between own accounts. */
export function isTransferPair(expense: PairSide, income: PairSide): boolean {
  if (expense.type !== "expense" || income.type !== "income") return false;
  if (expense.accountId === income.accountId) return false;
  if (expense.totalAmount !== income.totalAmount || expense.totalAmount <= 0) return false;
  if (!isPlainOperation(expense) || !isPlainOperation(income)) return false;
  const gap = Math.abs(new Date(expense.occurredAt).getTime() - new Date(income.occurredAt).getTime());
  return gap <= TRANSFER_MATCH_WINDOW_DAYS * DAY_MS;
}

export interface TransferPairCandidate<T extends PairSide> {
  expense: T;
  income: T;
}

/**
 * Only UNAMBIGUOUS pairs: an expense with exactly one possible income that itself has exactly one possible expense.
 * Two 500-ruble coffees and two 500-ruble top-ups in a week cannot be told apart, so none of them is proposed.
 */
export function findTransferPairs<T extends PairSide>(transactions: readonly T[]): TransferPairCandidate<T>[] {
  const expenses = transactions.filter((t) => t.type === "expense");
  const incomes = transactions.filter((t) => t.type === "income");
  const incomesOf = new Map(expenses.map((expense) => [expense.id, incomes.filter((income) => isTransferPair(expense, income))]));
  const expensesOf = new Map(incomes.map((income) => [income.id, expenses.filter((expense) => isTransferPair(expense, income))]));
  const pairs: TransferPairCandidate<T>[] = [];
  for (const expense of expenses) {
    const candidates = incomesOf.get(expense.id) ?? [];
    if (candidates.length !== 1) continue;
    const income = candidates[0]!;
    if ((expensesOf.get(income.id) ?? []).length !== 1) continue;
    pairs.push({ expense, income });
  }
  return pairs.sort((a, b) => b.expense.occurredAt.localeCompare(a.expense.occurredAt));
}
