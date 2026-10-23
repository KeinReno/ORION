import { z } from "zod";
import { LIST_ITEMS_MAX, listSchema, noteSchema, taskSchema, type List, type Note, type Task } from "@orion/shared-types";
import { createMobileFinance, mobileFinanceSchema, type FinanceDraft, type MobileFinance } from "./mobile-finance";
import { draftSchema, type Draft } from "./mobile-models";
import { mobileListDraftSchema, type MobileListDraft } from "./mobile-lists";
import type { MobileSnapshot } from "./index";

export const portableBackupSchema = z.object({
  format: z.literal("kaiden-orion-android-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  local: z.object({ finance: mobileFinanceSchema.nullable().default(null), lists: z.array(listSchema).default([]), listDrafts: z.record(mobileListDraftSchema).default({}), tasks: z.array(taskSchema), notes: z.array(noteSchema), draft: draftSchema.nullable(), remoteDrafts: z.record(draftSchema) }),
  remote: z.object({
    nodeId: z.string(), workspaceId: z.string(), workspaceName: z.string(),
    tasks: z.array(taskSchema), notes: z.array(noteSchema), lists: z.array(listSchema).default([]),
    conflicts: z.array(z.object({ entity: z.string(), entityId: z.string(), fields: z.record(z.unknown()).optional(), lost: z.record(z.unknown()).optional(), outcome: z.string() })).default([]),
  }).nullable(),
});
export function createPortableBackup(local: MobileSnapshot, remote: {
  nodeId: string; workspaceId: string; workspaceName: string; tasks: Task[]; notes: Note[]; lists?: List[];
  conflicts?: Array<{ entity: string; entityId: string; fields?: Record<string, unknown>; lost?: Record<string, unknown>; outcome: string }>;
} | null = null): string {
  const backup = portableBackupSchema.parse({
    format: "kaiden-orion-android-backup", version: 1, createdAt: new Date().toISOString(),
    local: { finance: local.finance, lists: local.lists, listDrafts: local.listDrafts, tasks: local.tasks, notes: local.notes, draft: local.draft, remoteDrafts: local.remoteDrafts }, remote,
  });
  return JSON.stringify(backup, null, 2);
}
export type PortableBackup = z.infer<typeof portableBackupSchema>;

/** Same ceiling as the native export/import picker: larger files are rejected before parsing. */
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024;

/** What the restore preview shows before anything is written. */
export interface PortableBackupPreview {
  createdAt: string;
  tasks: number;
  notes: number;
  lists: number;
  listItems: number;
  financeAccounts: number;
  financeCategories: number;
  financeTransactions: number;
  hasRemote: boolean;
}
export type PortableBackupInspection =
  | { ok: true; backup: PortableBackup; preview: PortableBackupPreview }
  | { ok: false; error: string };

/**
 * Restore modes never touch settings, LAN pairing, device identity or the remote replica.
 * `merge` only adds records whose ids are absent; `replace` swaps all local records for the
 * file's, which also discards the local operation queue and task order.
 */
export type RestoreMode = "merge" | "replace";
export interface RestoreResult {
  mode: RestoreMode;
  tasks: number;
  notes: number;
  lists: number;
  listItems: number;
  financeAccounts: number;
  financeCategories: number;
  financeTransactions: number;
  /** Existing records left untouched in merge mode. */
  skipped: number;
  outboxCleared: number;
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Копия повреждена: повторяются идентификаторы ${label}.`);
}
function checkTasks(tasks: readonly Task[]) {
  unique(tasks.map((task) => task.id), "задач");
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const seen = new Set<string>();
    let cursor: Task | undefined = task;
    while (cursor?.parentId) {
      if (seen.has(cursor.id)) throw new Error("Копия повреждена: пункт чек-листа ссылается сам на себя.");
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentId);
      if (!cursor) throw new Error("Копия повреждена: пункт чек-листа ссылается на отсутствующую задачу.");
    }
  }
}
function checkLists(lists: readonly List[]) {
  unique(lists.map((list) => list.id), "списков");
  unique(lists.flatMap((list) => list.items.map((item) => item.id)), "пунктов списков");
  for (const list of lists) {
    if (list.items.length > LIST_ITEMS_MAX) throw new Error(`Копия повреждена: в списке «${list.name}» больше ${LIST_ITEMS_MAX} пунктов.`);
    if (list.items.some((item) => item.listId !== list.id)) throw new Error("Копия повреждена: пункт списка принадлежит другому списку.");
  }
}
function checkFinance(finance: MobileFinance | null) {
  if (!finance) return;
  unique(finance.accounts.map((account) => account.id), "счетов");
  unique(finance.categories.map((category) => category.id), "категорий");
  unique(finance.transactions.map((transaction) => transaction.id), "операций");
  const accounts = new Set(finance.accounts.map((account) => account.id));
  const categories = new Map(finance.categories.map((category) => [category.id, category]));
  for (const transaction of finance.transactions) {
    if (!accounts.has(transaction.accountId) || (transaction.toAccountId !== null && !accounts.has(transaction.toAccountId))) {
      throw new Error("Копия повреждена: операция ссылается на отсутствующий счёт.");
    }
    for (const line of transaction.lines) {
      if (line.categoryId === null) continue;
      const category = categories.get(line.categoryId);
      if (!category) throw new Error("Копия повреждена: операция ссылается на отсутствующую категорию.");
      if (transaction.type !== "transfer" && category.kind !== transaction.type) {
        throw new Error("Копия повреждена: категория не подходит к типу операции.");
      }
    }
  }
}
function parsePortableBackup(raw: string): PortableBackup {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Файл пуст. Выберите резервную копию Orion.");
  if (raw.length > MAX_BACKUP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("Файл больше 24 МБ и не может быть резервной копией Orion.");
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Файл не похож на резервную копию Orion: это не JSON."); }
  const parsed = portableBackupSchema.safeParse(value);
  if (!parsed.success) throw new Error("Файл не похож на резервную копию Orion или создан другой версией приложения.");
  const backup = parsed.data;
  unique(backup.local.notes.map((note) => note.id), "заметок");
  checkTasks(backup.local.tasks);
  checkLists(backup.local.lists);
  checkFinance(backup.local.finance);
  return backup;
}

/** Parses and validates a file without writing anything; safe to call on every file selection. */
export function inspectPortableBackup(raw: string): PortableBackupInspection {
  try {
    const backup = parsePortableBackup(raw);
    return {
      ok: true, backup,
      preview: {
        createdAt: backup.createdAt,
        tasks: backup.local.tasks.length,
        notes: backup.local.notes.length,
        lists: backup.local.lists.length,
        listItems: backup.local.lists.reduce((sum, list) => sum + list.items.length, 0),
        financeAccounts: backup.local.finance?.accounts.length ?? 0,
        financeCategories: backup.local.finance?.categories.length ?? 0,
        financeTransactions: backup.local.finance?.transactions.length ?? 0,
        hasRemote: backup.remote !== null,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Не удалось прочитать резервную копию." };
  }
}

function usableDraft(draft: Draft | null, tasks: readonly Task[], notes: readonly Note[]): Draft | null {
  if (!draft || draft.id === null) return draft;
  return (draft.kind === "task" ? tasks : notes).some((record) => record.id === draft.id) ? draft : null;
}
function usableListDraft(draft: MobileListDraft | undefined, lists: readonly List[]): MobileListDraft | undefined {
  if (!draft) return undefined;
  if (draft.kind === "list") return draft;
  const parent = lists.find((list) => list.id === draft.parentId);
  return parent ? draft : undefined;
}
function usableFinanceDraft(draft: FinanceDraft | null, finance: MobileFinance): FinanceDraft | null {
  if (!draft) return null;
  const account = finance.accounts.some((entry) => entry.id === draft.accountId && !entry.archivedAt);
  const category = finance.categories.some((entry) => entry.id === draft.categoryId && entry.kind === draft.type && !entry.archivedAt);
  return account && category ? draft : null;
}
function recomputeBalances(finance: MobileFinance) {
  for (const account of finance.accounts) {
    account.balance = account.startingBalance + finance.transactions
      .reduce((sum, entry) => sum
        + (entry.accountId === account.id ? (entry.type === "income" ? entry.totalAmount : -entry.totalAmount) : 0)
        + (entry.type === "transfer" && entry.toAccountId === account.id ? entry.totalAmount : 0), 0);
  }
}
function restoredFinance(workspaceId: string, source: MobileFinance, draft: FinanceDraft | null): MobileFinance {
  const finance: MobileFinance = {
    accounts: source.accounts.map((account) => ({ ...account, workspaceId })),
    categories: source.categories.map((category) => ({ ...category, workspaceId })),
    transactions: source.transactions.map((transaction) => ({ ...transaction, workspaceId })),
    draft: null,
    lastAccountId: null,
  };
  recomputeBalances(finance);
  const accountIds = new Set(finance.accounts.map((account) => account.id));
  finance.draft = usableFinanceDraft(draft, finance);
  finance.lastAccountId = [source.lastAccountId, source.draft?.accountId, finance.accounts[0]?.id]
    .find((id): id is string => typeof id === "string" && accountIds.has(id)) ?? null;
  return finance;
}

/**
 * Applies a validated portable backup to an already-cloned snapshot. Pure with respect to
 * persistence: the caller (MobileRepository.transaction) writes the result atomically and
 * still enforces the 8 MiB snapshot ceiling. The remote section is informational only.
 */
export function applyPortableRestore(next: MobileSnapshot, raw: string, mode: RestoreMode): RestoreResult {
  const backup = parsePortableBackup(raw);
  const source = backup.local;
  const result: RestoreResult = {
    mode, tasks: 0, notes: 0, lists: 0, listItems: 0,
    financeAccounts: 0, financeCategories: 0, financeTransactions: 0, skipped: 0, outboxCleared: 0,
  };
  if (mode === "replace") {
    next.tasks = source.tasks.map((task) => ({ ...task, workspaceId: next.workspaceId }));
    next.notes = source.notes.map((note) => ({ ...note, workspaceId: next.workspaceId }));
    next.lists = source.lists.map((list) => ({
      ...list, workspaceId: next.workspaceId, items: list.items.map((item) => ({ ...item })),
    }));
    result.tasks = next.tasks.length; result.notes = next.notes.length;
    result.lists = next.lists.length; result.listItems = next.lists.reduce((sum, list) => sum + list.items.length, 0);
    // Unfinished input on the phone is kept even when records are swapped.
    if (!next.draft) next.draft = usableDraft(source.draft, next.tasks, next.notes);
    if (!next.listDrafts.phone) {
      const draft = usableListDraft(source.listDrafts.phone, next.lists);
      if (draft) next.listDrafts.phone = draft;
    }
    if (source.finance) {
      const currentFinance = next.finance;
      next.finance = restoredFinance(next.workspaceId, source.finance, currentFinance?.draft ?? source.finance.draft);
      next.finance.draft = currentFinance?.draft ?? next.finance.draft;
      next.finance.lastAccountId = (currentFinance?.lastAccountId && next.finance.accounts.some((account) => account.id === currentFinance.lastAccountId))
        ? currentFinance.lastAccountId : next.finance.lastAccountId;
      result.financeAccounts = next.finance.accounts.length;
      result.financeCategories = next.finance.categories.length;
      result.financeTransactions = next.finance.transactions.length;
    }
    result.outboxCleared = next.outbox.length;
    next.outbox = [];
    next.taskOrder.phone = [];
    next.lastBackupSeq = null;
    return result;
  }

  const taskIds = new Set(next.tasks.map((task) => task.id));
  const noteIds = new Set(next.notes.map((note) => note.id));
  const listIds = new Set(next.lists.map((list) => list.id));
  const itemIds = new Set(next.lists.flatMap((list) => list.items.map((item) => item.id)));
  const addedTasks = source.tasks.filter((task) => !taskIds.has(task.id)).map((task) => ({ ...task, workspaceId: next.workspaceId }));
  const addedNotes = source.notes.filter((note) => !noteIds.has(note.id)).map((note) => ({ ...note, workspaceId: next.workspaceId }));
  const addedLists = source.lists
    .filter((list) => !listIds.has(list.id) && !list.items.some((item) => itemIds.has(item.id)))
    .map((list) => ({ ...list, workspaceId: next.workspaceId, items: list.items.map((item) => ({ ...item })) }));
  result.skipped = source.tasks.length - addedTasks.length + source.notes.length - addedNotes.length + source.lists.length - addedLists.length;

  const combinedTaskIds = new Set([...taskIds, ...addedTasks.map((task) => task.id)]);
  if (addedTasks.some((task) => task.parentId !== null && !combinedTaskIds.has(task.parentId))) {
    throw new Error("Копия повреждена: пункт чек-листа ссылается на отсутствующую задачу.");
  }
  next.tasks = [...next.tasks, ...addedTasks];
  checkTasks(next.tasks); // Existing ids can change the meaning of imported parent links.
  next.notes = [...next.notes, ...addedNotes];
  next.lists = [...next.lists, ...addedLists];
  result.tasks = addedTasks.length; result.notes = addedNotes.length;
  result.lists = addedLists.length; result.listItems = addedLists.reduce((sum, list) => sum + list.items.length, 0);

  if (source.finance) {
    const finance = next.finance ?? createMobileFinance(next.workspaceId);
    const accountIds = new Set(finance.accounts.map((account) => account.id));
    const categoryKinds = new Map(finance.categories.map((category) => [category.id, category.kind]));
    const transactionIds = new Set(finance.transactions.map((transaction) => transaction.id));
    const addedAccounts = source.finance.accounts.filter((account) => !accountIds.has(account.id)).map((account) => ({ ...account, workspaceId: next.workspaceId }));
    const addedCategories = source.finance.categories.filter((category) => !categoryKinds.has(category.id)).map((category) => ({ ...category, workspaceId: next.workspaceId }));
    for (const account of addedAccounts) accountIds.add(account.id);
    for (const category of addedCategories) categoryKinds.set(category.id, category.kind);
    const addedTransactions = [];
    for (const transaction of source.finance.transactions) {
      if (transactionIds.has(transaction.id)
        || !accountIds.has(transaction.accountId)
        || (transaction.toAccountId !== null && !accountIds.has(transaction.toAccountId))
        || transaction.lines.some((line) => line.categoryId !== null && (transaction.type === "transfer" || categoryKinds.get(line.categoryId) !== transaction.type))) {
        result.skipped += 1;
        continue;
      }
      addedTransactions.push({ ...transaction, workspaceId: next.workspaceId });
    }
    finance.accounts = [...finance.accounts, ...addedAccounts];
    finance.categories = [...finance.categories, ...addedCategories];
    finance.transactions = [...finance.transactions, ...addedTransactions];
    recomputeBalances(finance);
    next.finance = finance;
    result.financeAccounts = addedAccounts.length;
    result.financeCategories = addedCategories.length;
    result.financeTransactions = addedTransactions.length;
  }
  if (!next.listDrafts.phone) {
    const draft = usableListDraft(source.listDrafts.phone, next.lists);
    if (draft) { next.listDrafts.phone = draft; next.lastBackupSeq = null; }
  }
  if (result.tasks || result.notes || result.lists || result.financeAccounts || result.financeCategories || result.financeTransactions) {
    next.lastBackupSeq = null;
  }
  return result;
}
