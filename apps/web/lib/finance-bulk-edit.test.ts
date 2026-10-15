import { describe, expect, it } from "vitest";
import type { Transaction } from "@orion/shared-types";
import { bulkPatch, recreateInput } from "./finance-bulk-edit";

const tx = (patch: Partial<Transaction>): Transaction => ({
  id: "t", workspaceId: "w", accountId: "a", toAccountId: null, type: "expense", note: "хлеб", tags: ["еда"], projectId: null,
  reconciledAt: null, importedRef: null, occurredAt: "2026-10-01T10:00:00.000Z",
  lines: [{ id: "l", categoryId: null, amount: 500 }], totalAmount: 500, createdAt: "", updatedAt: "", ...patch
});

describe("bulkPatch", () => {
  it("sets a category only on a plain operation of the same direction", () => {
    const change = { kind: "category", categoryId: "c", categoryKind: "expense" } as const;
    expect(bulkPatch(tx({}), change)).toEqual({ lines: [{ categoryId: "c", amount: 500 }] });
    expect(bulkPatch(tx({ type: "income" }), change)).toBeNull();
    expect(bulkPatch(tx({ type: "transfer", toAccountId: "b" }), change)).toBeNull();
    expect(bulkPatch(tx({ lines: [{ id: "1", categoryId: null, amount: 1 }, { id: "2", categoryId: null, amount: 2 }] }), change)).toBeNull();
    expect(bulkPatch(tx({ lines: [{ id: "l", categoryId: "c", amount: 500 }] }), change)).toBeNull();
  });

  it("sets or clears a project, and skips what already matches", () => {
    expect(bulkPatch(tx({}), { kind: "project", projectId: "p" })).toEqual({ projectId: "p" });
    expect(bulkPatch(tx({ projectId: "p" }), { kind: "project", projectId: null })).toEqual({ projectId: null });
    expect(bulkPatch(tx({ projectId: "p" }), { kind: "project", projectId: "p" })).toBeNull();
  });

  it("adds a tag once", () => {
    expect(bulkPatch(tx({}), { kind: "tag", tag: " отпуск " })).toEqual({ tags: ["еда", "отпуск"] });
    expect(bulkPatch(tx({}), { kind: "tag", tag: "еда" })).toBeNull();
    expect(bulkPatch(tx({}), { kind: "tag", tag: "  " })).toBeNull();
  });
});

describe("recreateInput", () => {
  it("keeps the money and drops identity, links and the import reference", () => {
    const input = recreateInput(tx({ importedRef: "bank:1", projectId: "p" }));
    expect(input).toMatchObject({ accountId: "a", type: "expense", note: "хлеб", projectId: "p", lines: [{ categoryId: null, amount: 500 }] });
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("importedRef");
  });
});
