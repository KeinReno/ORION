import type { CategoryBreakdownEntry, Transaction } from "@orion/shared-types";
import { normalizeNote } from "./finance-recurring-suggest";

export interface CategoryDelta {
  categoryId: string | null;
  categoryName: string;
  current: number;
  previous: number;
  /** current − previous, kopecks. */
  delta: number;
  /** delta / previous; null when there was nothing to compare with (a new category is «новая», not «+∞%»). */
  ratio: number | null;
}

export interface PeriodComparison {
  currentTotal: number;
  previousTotal: number;
  /** Largest changes first, by absolute size. */
  categories: CategoryDelta[];
}

/** Expense by category, this period against the one before it. */
export function compareBreakdowns(current: readonly CategoryBreakdownEntry[], previous: readonly CategoryBreakdownEntry[], limit = 6): PeriodComparison {
  const keyOf = (entry: CategoryBreakdownEntry): string => entry.categoryId ?? `name:${entry.categoryName}`;
  const rows = new Map<string, CategoryDelta>();
  for (const entry of current) {
    rows.set(keyOf(entry), { categoryId: entry.categoryId, categoryName: entry.categoryName, current: entry.amount, previous: 0, delta: 0, ratio: null });
  }
  for (const entry of previous) {
    const row = rows.get(keyOf(entry));
    if (row) row.previous = entry.amount;
    else rows.set(keyOf(entry), { categoryId: entry.categoryId, categoryName: entry.categoryName, current: 0, previous: entry.amount, delta: 0, ratio: null });
  }
  const categories = [...rows.values()]
    .map((row) => ({ ...row, delta: row.current - row.previous, ratio: row.previous > 0 ? (row.current - row.previous) / row.previous : null }))
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
  return {
    currentTotal: current.reduce((sum, entry) => sum + entry.amount, 0),
    previousTotal: previous.reduce((sum, entry) => sum + entry.amount, 0),
    categories
  };
}

export interface PayeeTotal {
  key: string;
  label: string;
  amount: number;
  count: number;
}

/**
 * Where the money goes: expenses grouped by what the note says (the same normalisation as the recurring-payment hint),
 * largest first. Transfers are not spending. An operation without a note is one group, «Без описания».
 */
export function topPayees(transactions: readonly Transaction[], limit = 8): PayeeTotal[] {
  const groups = new Map<string, PayeeTotal>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const normalized = normalizeNote(transaction.note);
    const key = normalized || "—";
    const existing = groups.get(key);
    if (existing) {
      existing.amount += transaction.totalAmount;
      existing.count += 1;
    } else {
      groups.set(key, { key, label: normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Без описания", amount: transaction.totalAmount, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

export interface CsvNames {
  account: (id: string) => string;
  category: (id: string) => string;
  project: (id: string) => string;
}

/** Byte-order mark: without it Excel reads a UTF-8 file as a legacy code page and Cyrillic turns to garbage. */
const BOM = String.fromCharCode(0xfeff);

const TYPE_LABEL = { income: "Доход", expense: "Расход", transfer: "Перевод" } as const;

function cell(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rubles with a comma, signed by direction: an expense is negative, a transfer has no sign. */
function money(transaction: Transaction): string {
  const rubles = (transaction.totalAmount / 100).toFixed(2).replace(".", ",");
  return transaction.type === "expense" ? `-${rubles}` : rubles;
}

/**
 * The operations as a spreadsheet file Excel opens directly: `;` separated (the Russian list separator), a BOM so
 * Cyrillic survives, one row per operation (a split shows all its categories in one cell).
 */
export function transactionsToCsv(transactions: readonly Transaction[], names: CsvNames): string {
  const header = ["Дата", "Тип", "Счёт", "На счёт", "Категория", "Сумма", "Заметка", "Теги", "Проект"];
  const rows = transactions.map((transaction) => {
    const categories = [...new Set(transaction.lines.map((line) => line.categoryId).filter((id): id is string => Boolean(id)).map(names.category))].join(", ");
    return [
      transaction.occurredAt.slice(0, 10),
      TYPE_LABEL[transaction.type],
      names.account(transaction.accountId),
      transaction.toAccountId ? names.account(transaction.toAccountId) : "",
      categories,
      money(transaction),
      transaction.note,
      transaction.tags.join(", "),
      transaction.projectId ? names.project(transaction.projectId) : ""
    ].map(cell);
  });
  return `${BOM}${[header, ...rows].map((row) => row.join(";")).join("\r\n")}\r\n`;
}
