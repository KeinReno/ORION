import { z } from "zod";
import { accountSchema, financeCategorySchema, transactionSchema, createTransactionInputSchema, type Account, type FinanceCategory } from "@orion/shared-types";

export const financeDraftSchema = z.object({
  dateMode: z.enum(["today", "custom"]).default("custom"),
  id: z.string().uuid(), type: z.enum(["expense", "income"]), amount: z.string().max(30),
  accountId: z.string(), categoryId: z.string(), note: z.string().max(2000), date: z.string(),
});
export type FinanceDraft = z.infer<typeof financeDraftSchema>;
export const mobileFinanceSchema = z.object({
  accounts: z.array(accountSchema), categories: z.array(financeCategorySchema), transactions: z.array(transactionSchema),
  draft: financeDraftSchema.nullable(), lastAccountId: z.string().nullable(),
});
export type MobileFinance = z.infer<typeof mobileFinanceSchema>;

/** Parse decimal input without floating point arithmetic or rounding. */
export function parseMoney(value: string): number {
  const match = /^(\d{1,11})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Введите сумму: например, 250 или 250,50. Не больше двух знаков после запятой.");
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Сумма должна быть больше нуля.");
  return amount;
}
export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function resolveFinanceDate(draft: FinanceDraft, now = new Date()): FinanceDraft {
  return draft.dateMode === "today" ? { ...draft, date: localDate(now) } : draft;
}
export function createMobileFinance(workspaceId: string): MobileFinance {
  const now = new Date().toISOString();
  const accounts: Account[] = (["Карта", "Наличные"] as const).map((name, index) => ({
    id: crypto.randomUUID(), workspaceId, name, kind: index ? "cash" : "card", context: "personal", visibility: "private",
    ownerId: null, currency: "RUB", startingBalance: 0, balance: 0, archivedAt: null, createdAt: now, updatedAt: now,
  }));
  const categories: FinanceCategory[] = ([
    ["expense", ["Продукты", "Кафе", "Транспорт", "Дом", "Здоровье", "Покупки", "Другое"]],
    ["income", ["Зарплата", "Подработка", "Подарок", "Другое"]],
  ] as const).flatMap(([kind, names]) => names.map((name) => ({
    id: crypto.randomUUID(), workspaceId, name, kind, color: null, archivedAt: null, createdAt: now,
  })));
  return { accounts, categories, transactions: [], draft: null, lastAccountId: accounts[0]!.id };
}
export function applyFinanceEntry(finance: MobileFinance, workspaceId: string, draft: FinanceDraft): void {
  const parsed = resolveFinanceDate(financeDraftSchema.parse(draft));
  const account = finance.accounts.find((item) => item.id === parsed.accountId && !item.archivedAt && item.workspaceId === workspaceId);
  const category = finance.categories.find((item) => item.id === parsed.categoryId && item.kind === parsed.type && !item.archivedAt && item.workspaceId === workspaceId);
  if (!account || !category) throw new Error("Выберите счёт и категорию для этой операции.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) throw new Error("Укажите дату операции.");
  // Local noon preserves the selected calendar date in this device's time zone.
  const occurred = new Date(parsed.date + "T12:00:00");
  if (Number.isNaN(occurred.getTime()) || localDate(occurred) !== parsed.date) throw new Error("Проверьте дату операции.");
  const amount = parseMoney(parsed.amount);
  const input = createTransactionInputSchema.parse({ ...parsed, occurredAt: occurred.toISOString(), lines: [{ categoryId: category.id, amount }] });
  const previous = finance.transactions.find((item) => item.id === parsed.id);
  const now = new Date().toISOString();
  const transaction = transactionSchema.parse({
    ...input, id: parsed.id, workspaceId, toAccountId: null, tags: [], projectId: null, reconciledAt: null, importedRef: null,
    lines: [{ id: previous?.lines[0]?.id ?? crypto.randomUUID(), categoryId: category.id, amount }],
    totalAmount: amount, createdAt: previous?.createdAt ?? now, updatedAt: now,
  });
  const otherAmounts = finance.transactions.filter((item) => item.id !== parsed.id).reduce((sum, item) => sum + BigInt(item.totalAmount), 0n);
  if (otherAmounts + BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Общая сумма операций превышает допустимый предел.");
  finance.transactions = [...finance.transactions.filter((item) => item.id !== parsed.id), transaction];
  finance.lastAccountId = account.id;
  finance.draft = null;
  // DTO balance is derived; transfers are not exposed in this first mobile surface.
  for (const item of finance.accounts) item.balance = item.startingBalance + finance.transactions
    .filter((entry) => entry.accountId === item.id).reduce((sum, entry) => sum + (entry.type === "income" ? entry.totalAmount : -entry.totalAmount), 0);
}
