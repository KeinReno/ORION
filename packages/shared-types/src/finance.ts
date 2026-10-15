import { z } from "zod";

/**
 * ORION v0.8 "Финансы" — see docs/HISTORY.md. Five entities, all mirroring the
 * Note/Task pattern: a plain DTO schema for what the API returns, plus
 * create/update input schemas for what a client may send. Money is always
 * an integer in kopecks (minor units) at this boundary — the same reason
 * dates are always ISO strings here, not a locale-formatted string: no
 * ambiguity, no float rounding.
 */

export const accountKindSchema = z.enum(["cash", "card", "savings", "other"]);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** Чьи деньги на счёте. Метка для фильтров и итогов, а не правило доступа. */
export const accountContextSchema = z.enum(["personal", "family", "work"]);
export type AccountContext = z.infer<typeof accountContextSchema>;
export const ACCOUNT_CONTEXT_LABEL: Record<AccountContext, string> = { personal: "Личные", family: "Семейные", work: "Рабочие" };

export const accountSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: accountKindSchema,
  context: accountContextSchema,
  currency: z.string(),
  startingBalance: z.number().int(),
  /** startingBalance + net of every transaction on this account — computed by AccountsService, never stored. */
  balance: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Account = z.infer<typeof accountSchema>;

export const createAccountInputSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  kind: accountKindSchema.default("other"),
  context: accountContextSchema.default("personal"),
  startingBalance: z.number().int().default(0),
  currency: z.string().length(3).default("RUB")
});
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

export const updateAccountInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  kind: accountKindSchema.optional(),
  context: accountContextSchema.optional(),
  currency: z.string().length(3).optional(),
  startingBalance: z.number().int().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

export const financeCategoryKindSchema = z.enum(["income", "expense"]);
export type FinanceCategoryKind = z.infer<typeof financeCategoryKindSchema>;

export const financeCategorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: financeCategoryKindSchema,
  color: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string()
});
export type FinanceCategory = z.infer<typeof financeCategorySchema>;

export const createFinanceCategoryInputSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(60),
  kind: financeCategoryKindSchema,
  color: z.string().max(20).nullable().optional()
});
export type CreateFinanceCategoryInput = z.infer<typeof createFinanceCategoryInputSchema>;

export const updateFinanceCategoryInputSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().max(20).nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateFinanceCategoryInput = z.infer<typeof updateFinanceCategoryInputSchema>;

/**
 * `transfer` (v0.9) moves money between two of the user's own accounts —
 * never income or expense anywhere (category budgets, reports): it leaves
 * one account and enters another, net zero on total net worth. See
 * docs/HISTORY.md v0.9.
 */
export const transactionTypeSchema = z.enum(["income", "expense", "transfer"]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const transactionLineSchema = z.object({
  id: z.string(),
  /** Null only for a transfer's single line — a transfer has no category. */
  categoryId: z.string().nullable(),
  amount: z.number().int().positive()
});
export type TransactionLine = z.infer<typeof transactionLineSchema>;

/**
 * A transaction is a header; the money lives in `lines` (v0.9). A plain
 * (non-split) income/expense is just one line — splitting into several
 * categories and a transfer aren't two different features bolted on
 * separately, they're the same mechanism: a transfer is a transaction with
 * exactly one line that has no category, `toAccountId` set instead.
 */
export const transactionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  accountId: z.string(),
  /** Only set for type = transfer — the destination account. */
  toAccountId: z.string().nullable(),
  type: transactionTypeSchema,
  note: z.string(),
  /** Free-form labels (v0.13) — a flat scalar list, same idiom as Note.tags, unrelated to CategoryRule. */
  tags: z.array(z.string()),
  /**
   * Optional project this operation belongs to (v0.14). The column and both
   * input schemas had it, but the response shape didn't — so a client could
   * set a project and never see it back.
   */
  projectId: z.string().nullable(),
  reconciledAt: z.string().nullable(),
  importedRef: z.string().nullable(),
  occurredAt: z.string(),
  lines: z.array(transactionLineSchema),
  /** Sum of `lines[].amount` — convenience so callers don't reduce it themselves. */
  totalAmount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Transaction = z.infer<typeof transactionSchema>;

const transactionLineInputSchema = z.object({
  categoryId: z.string().nullable().optional(),
  amount: z.number().int().positive("Сумма должна быть больше нуля")
});
export type TransactionLineInput = z.infer<typeof transactionLineInputSchema>;

/**
 * The transfer-vs-split cross-field shape (exactly one uncategorised line +
 * toAccountId for a transfer; one-or-more categorised lines + no toAccountId
 * otherwise) is enforced in `TransactionsService`, not here — an update is a
 * partial PATCH, and checking it correctly means merging with the record
 * already in the database, which a standalone zod schema has no access to.
 * See `assertTransactionShape` in `finance-refs.util.ts` (backend).
 */
export const createTransactionInputSchema = z.object({
  accountId: z.string(),
  /** Only for type = transfer — the destination account. */
  toAccountId: z.string().nullable().optional(),
  type: transactionTypeSchema,
  note: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(40)).default([]),
  projectId: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
  lines: z.array(transactionLineInputSchema).min(1, "Нужна хотя бы одна строка")
});
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;

export const updateTransactionInputSchema = z.object({
  accountId: z.string().optional(),
  toAccountId: z.string().nullable().optional(),
  type: transactionTypeSchema.optional(),
  note: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  projectId: z.string().nullable().optional(),
  reconciledAt: z.string().datetime().nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  lines: z.array(transactionLineInputSchema).min(1).optional()
});
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;

export const reconcileAccountInputSchema = z.object({
  actualBalance: z.number().int()
});
export type ReconcileAccountInput = z.infer<typeof reconcileAccountInputSchema>;

/**
 * Import of operations from a file (CSV of a bank statement or of FinControl). One request is one
 * atomic batch into ONE account: either every accepted row is written or none is. `ref` is the idempotency key
 * of a row (`Transaction.importedRef`, unique per workspace): sending the same file twice writes nothing
 * the second time. `dryRun` (the default) computes exactly what a real run would do, and writes nothing.
 * The amount is in minor units and positive — the sign lives in `type`; transfers are never imported
 * (a transfer needs two confirmed accounts).
 */
export const financeImportRowSchema = z.object({
  ref: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
  type: z.enum(["income", "expense"]),
  amount: z.number().int().positive().max(2_000_000_000),
  note: z.string().max(2000).default(""),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([])
});
export type FinanceImportRow = z.infer<typeof financeImportRowSchema>;

export const FINANCE_IMPORT_MAX_ROWS = 2000;

export const financeImportInputSchema = z.object({
  accountId: z.string(),
  dryRun: z.boolean().default(true),
  rows: z.array(financeImportRowSchema).min(1, "В файле нет строк").max(FINANCE_IMPORT_MAX_ROWS, `Не больше ${FINANCE_IMPORT_MAX_ROWS} строк за раз`)
});
export type FinanceImportInput = z.infer<typeof financeImportInputSchema>;

export const financeImportResultSchema = z.object({
  dryRun: z.boolean(),
  /** Rows that were written (or, in a dry run, that would be). */
  imported: z.number().int(),
  /** Rows already imported earlier (same `ref`) or repeated inside this request. */
  duplicates: z.number().int(),
  /** Rows refused, with the reason; `line` is the 1-based position in the request. */
  errors: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  incomeTotal: z.number().int(),
  expenseTotal: z.number().int()
});
export type FinanceImportResult = z.infer<typeof financeImportResultSchema>;

/**
 * ЗАРЕЗЕРВИРОВАНО, кода нет — прогноз по месяцам (средние за историю,
 * спроецированные вперёд) к отчётам v0.13 не добавлялся. Схема лежит здесь,
 * чтобы форма ответа была решена заранее.
 */
export const financeForecastPointSchema = z.object({
  date: z.string(),
  balance: z.number().int(),
  income: z.number().int(),
  expense: z.number().int()
});
export type FinanceForecastPoint = z.infer<typeof financeForecastPointSchema>;

/**
 * A rule is a plain substring match against `Transaction.note` (case-
 * insensitive) suggesting a category — applied only in the frontend
 * (`TransactionForm`), never server-side, so the API never silently
 * rewrites a category the user didn't choose. See docs/HISTORY.md v0.13.
 */
export const categoryRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  matchText: z.string(),
  categoryId: z.string(),
  createdAt: z.string()
});
export type CategoryRule = z.infer<typeof categoryRuleSchema>;

export const createCategoryRuleInputSchema = z.object({
  matchText: z.string().min(1, "Текст обязателен").max(200),
  categoryId: z.string()
});
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleInputSchema>;

/**
 * A goal is tied to one savings account (v0.13, chosen over a separate
 * contribution ledger) — `currentAmount` is just that account's already-
 * computed balance, filled in by `GoalsService`, never stored.
 */
export const savingsGoalSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  accountId: z.string(),
  targetAmount: z.number().int().positive(),
  targetDate: z.string().nullable(),
  currentAmount: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string()
});
export type SavingsGoal = z.infer<typeof savingsGoalSchema>;

export const createSavingsGoalInputSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  accountId: z.string(),
  targetAmount: z.number().int().positive("Сумма должна быть больше нуля"),
  targetDate: z.string().datetime().nullable().optional()
});
export type CreateSavingsGoalInput = z.infer<typeof createSavingsGoalInputSchema>;

export const updateSavingsGoalInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  accountId: z.string().optional(),
  targetAmount: z.number().int().positive().optional(),
  targetDate: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable().optional()
});
export type UpdateSavingsGoalInput = z.infer<typeof updateSavingsGoalInputSchema>;

export const budgetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  categoryId: z.string(),
  /** First-of-month, ISO. */
  month: z.string(),
  limitAmount: z.number().int().positive(),
  /** Sum of expense transactions in that category for that month — computed by BudgetsService. */
  spent: z.number().int()
});
export type Budget = z.infer<typeof budgetSchema>;

export const createBudgetInputSchema = z.object({
  categoryId: z.string(),
  month: z.string().datetime(),
  limitAmount: z.number().int().positive("Лимит должен быть больше нуля")
});
export type CreateBudgetInput = z.infer<typeof createBudgetInputSchema>;

export const updateBudgetInputSchema = z.object({
  limitAmount: z.number().int().positive().optional()
});
export type UpdateBudgetInput = z.infer<typeof updateBudgetInputSchema>;

export const recurrenceIntervalSchema = z.enum(["weekly", "monthly"]);
export type RecurrenceInterval = z.infer<typeof recurrenceIntervalSchema>;

export const recurringTransactionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  accountId: z.string(),
  categoryId: z.string().nullable(),
  type: transactionTypeSchema,
  amount: z.number().int().positive(),
  note: z.string(),
  interval: recurrenceIntervalSchema,
  /** monthly: 1-28 (day of month); weekly: 0-6 (Monday = 0). */
  anchorDay: z.number().int().min(0).max(28),
  nextRunAt: z.string(),
  pausedAt: z.string().nullable(),
  createdAt: z.string()
});
export type RecurringTransaction = z.infer<typeof recurringTransactionSchema>;

export const createRecurringTransactionInputSchema = z.object({
  accountId: z.string(),
  categoryId: z.string().nullable().optional(),
  type: transactionTypeSchema,
  amount: z.number().int().positive("Сумма должна быть больше нуля"),
  note: z.string().max(2000).default(""),
  interval: recurrenceIntervalSchema,
  anchorDay: z.number().int().min(0).max(28),
  /** First occurrence — the client computes this from interval+anchorDay, the server only advances it from here on. */
  nextRunAt: z.string().datetime()
});
export type CreateRecurringTransactionInput = z.infer<typeof createRecurringTransactionInputSchema>;

export const updateRecurringTransactionInputSchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  type: transactionTypeSchema.optional(),
  amount: z.number().int().positive().optional(),
  note: z.string().max(2000).optional(),
  interval: recurrenceIntervalSchema.optional(),
  anchorDay: z.number().int().min(0).max(28).optional(),
  nextRunAt: z.string().datetime().optional(),
  pausedAt: z.string().datetime().nullable().optional()
});
export type UpdateRecurringTransactionInput = z.infer<typeof updateRecurringTransactionInputSchema>;

/**
 * Reports (v0.9) — read-only aggregates, no create/update. `netWorth` is
 * the balance across every account as of the end of that month; a transfer
 * never appears in it (see `transactionTypeSchema` comment) — only
 * income/expense do.
 */
export const monthlyFinanceSummarySchema = z.object({
  /** "YYYY-MM". */
  month: z.string(),
  income: z.number().int(),
  expense: z.number().int(),
  netWorth: z.number().int()
});
export type MonthlyFinanceSummary = z.infer<typeof monthlyFinanceSummarySchema>;

export const categoryBreakdownEntrySchema = z.object({
  categoryId: z.string().nullable(),
  categoryName: z.string(),
  amount: z.number().int()
});
export type CategoryBreakdownEntry = z.infer<typeof categoryBreakdownEntrySchema>;
