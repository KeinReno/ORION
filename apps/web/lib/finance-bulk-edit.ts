import type { Transaction, UpdateTransactionInput } from "@orion/shared-types";

/** One change applied to every selected operation. */
export type BulkChange =
  | { kind: "category"; categoryId: string; categoryKind: "income" | "expense" }
  | { kind: "project"; projectId: string | null }
  | { kind: "tag"; tag: string };

/**
 * The PATCH body that applies `change` to one operation, or `null` when the change does not apply to it (so the caller
 * can say «пропущено N» instead of silently doing something else):
 *  - a category fits only a plain operation — one line, not a transfer — of the same direction (an expense category
 *    on an income would make the report lie); a split keeps its own per-line categories;
 *  - a tag that is already there is not re-added.
 */
export function bulkPatch(transaction: Transaction, change: BulkChange): UpdateTransactionInput | null {
  switch (change.kind) {
    case "category": {
      if (transaction.type === "transfer" || transaction.lines.length !== 1) return null;
      if (transaction.type !== change.categoryKind) return null;
      const line = transaction.lines[0]!;
      if (line.categoryId === change.categoryId) return null;
      return { lines: [{ categoryId: change.categoryId, amount: line.amount }] };
    }
    case "project":
      return transaction.projectId === change.projectId ? null : { projectId: change.projectId };
    case "tag": {
      const tag = change.tag.trim();
      if (!tag || transaction.tags.includes(tag)) return null;
      return { tags: [...transaction.tags, tag] };
    }
  }
}

/** The body that re-creates a deleted operation (undo). Links and an import reference are not restored. */
export function recreateInput(transaction: Transaction) {
  return {
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    type: transaction.type,
    note: transaction.note,
    tags: transaction.tags,
    projectId: transaction.projectId,
    occurredAt: transaction.occurredAt,
    lines: transaction.lines.map((line) => ({ categoryId: line.categoryId, amount: line.amount }))
  };
}
