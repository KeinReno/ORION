import { expect, it, vi } from "vitest";
import { MobileRepository, localDate, resolveFinanceDate, financeDraftSchema, type FinanceDraft } from "./index";
const disk = () => { let value: string | null = null; return { read: async () => value, write: async (next: string) => { value = next; } }; };
it("keeps the task view order durable, scoped and separate from domain operations", async () => {
  const storage = disk(); const repo = await MobileRepository.open(storage);
  await repo.saveEntry({ kind: "task", id: null, title: "Первое", body: "", priority: "normal" });
  await repo.saveEntry({ kind: "task", id: null, title: "Второе", body: "", priority: "normal" });
  const before = repo.snapshot(); const ids = before.tasks.map((task) => task.id).reverse();
  await repo.saveTaskOrder("phone", ids); await repo.saveTaskOrder("a".repeat(64), [...ids].reverse());
  const next = (await MobileRepository.open(storage)).snapshot();
  expect(next.taskOrder.phone).toEqual(ids); expect(next.taskOrder["a".repeat(64)]).toEqual([...ids].reverse());
  expect(next.tasks).toEqual(before.tasks); expect(next.outbox).toEqual(before.outbox); expect(next.deviceSeq).toBe(before.deviceSeq);
  await repo.clearRemote(); expect(repo.snapshot().taskOrder).toEqual({ phone: ids });
});
it("rejects duplicate task IDs and does not publish a failed order write", async () => {
  let raw: string | null = null; let fail = false;
  const repo = await MobileRepository.open({ read: async () => raw, write: async (value) => { if (fail) throw new Error("disk full"); raw = value; } });
  const id = crypto.randomUUID(); await expect(repo.saveTaskOrder("phone", [id, id])).rejects.toThrow();
  await expect(repo.saveTaskOrder("other-user", [id])).rejects.toThrow();
  fail = true; await expect(repo.saveTaskOrder("phone", [id])).rejects.toThrow(); expect(repo.snapshot().taskOrder).toEqual({});
});
it("updates automatic finance dates at save time across midnight and preserves explicit dates", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(2026, 9, 21, 23, 59));
    const repo = await MobileRepository.open(disk()); const finance = repo.snapshot().finance!;
    const draft: FinanceDraft = { id: crypto.randomUUID(), type: "expense", amount: "100", note: "", accountId: finance.accounts[0]!.id,
      categoryId: finance.categories.find((item) => item.kind === "expense")!.id, date: localDate(), dateMode: "today" };
    await repo.saveFinanceDraft(draft);
    vi.setSystemTime(new Date(2026, 9, 22, 0, 1));
    expect(resolveFinanceDate(draft).date).toBe("2026-10-22");
    await repo.saveFinanceEntry(draft);
    expect(localDate(new Date(repo.snapshot().finance!.transactions[0]!.occurredAt))).toBe("2026-10-22");
    await repo.saveFinanceEntry({ ...draft, id: crypto.randomUUID(), dateMode: "custom", date: "2026-10-10" });
    expect(repo.snapshot().finance!.transactions.some((entry) => localDate(new Date(entry.occurredAt)) === "2026-10-10")).toBe(true);
    const oldDraft: Partial<FinanceDraft> = { ...draft }; delete oldDraft.dateMode;
    expect(financeDraftSchema.parse(oldDraft).dateMode).toBe("custom");
  } finally { vi.useRealTimers(); }
});
