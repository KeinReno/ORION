import { describe, expect, it } from "vitest";
import { MobileRepository, createPortableBackup, portableBackupSchema, localDate, parseMoney, type FinanceDraft, type SnapshotStorage } from "./index";
class Disk implements SnapshotStorage {
  raw: string | null = null; fail = false;
  async read() { return this.raw; }
  async write(value: string) { if (this.fail) throw new Error("disk full"); this.raw = value; }
}
function entry(repo: MobileRepository, type: "income" | "expense" = "expense"): FinanceDraft {
  const finance = repo.snapshot().finance!;
  return { dateMode: "custom", id: crypto.randomUUID(), type, amount: "123,45", accountId: finance.accounts[0]!.id,
    categoryId: finance.categories.find((item) => item.kind === type)!.id, date: localDate(), note: "Обед" };
}
describe("mobile finance", () => {
  it("parses decimal minor units exactly and rejects invalid or rounded input", () => {
    expect(parseMoney("0,01")).toBe(1); expect(parseMoney("250.5")).toBe(25050); expect(parseMoney(" 001,20 ")).toBe(120);
    for (const value of ["0", "-2", "1,999", "1e3", "NaN", "1 000", "12,", "999999999999"]) expect(() => parseMoney(value)).toThrow();
  });
  it("migrates an old snapshot without losing tasks, outbox, identity or settings", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry({ kind: "task", id: null, title: "До обновления", body: "Сохранить", priority: "normal" });
    const before = repo.snapshot(); const legacy = JSON.parse(disk.raw!); delete legacy.finance; disk.raw = JSON.stringify(legacy);
    const migrated = (await MobileRepository.open(disk)).snapshot();
    expect(migrated.tasks).toEqual(before.tasks); expect(migrated.outbox).toEqual(before.outbox);
    expect(migrated.deviceId).toBe(before.deviceId); expect(migrated.settings).toEqual(before.settings);
    expect(migrated.finance!.accounts).toHaveLength(2);
    expect((await MobileRepository.open(disk)).snapshot().finance).toEqual(migrated.finance);
  });
  it("preserves draft and operations offline; upserts by stable id without sync operations", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk); const draft = entry(repo);
    await repo.saveFinanceDraft(draft); expect((await MobileRepository.open(disk)).snapshot().finance!.draft).toEqual(draft);
    await repo.saveFinanceEntry(draft); await repo.saveFinanceEntry({ ...draft, amount: "200" });
    const state = (await MobileRepository.open(disk)).snapshot();
    expect(state.finance!.transactions).toHaveLength(1); expect(state.finance!.transactions[0]!.totalAmount).toBe(20000);
    expect(state.finance!.accounts[0]!.balance).toBe(-20000); expect(state.finance!.draft).toBeNull(); expect(state.outbox).toEqual([]);
    const income = entry(repo, "income"); await repo.saveFinanceEntry(income);
    expect(repo.snapshot().finance!.accounts[0]!.balance).toBe(-7655);
    await repo.deleteFinanceEntry(draft.id); expect(repo.snapshot().finance!.accounts[0]!.balance).toBe(12345);
  });
  it("does not publish failed writes and keeps the recovery draft", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk); const draft = entry(repo);
    await repo.saveFinanceDraft(draft); const before = repo.snapshot(); disk.fail = true;
    await expect(repo.saveFinanceEntry(draft)).rejects.toThrow("disk full"); expect(repo.snapshot()).toEqual(before);
    disk.fail = false; await repo.saveFinanceEntry(draft); expect(repo.snapshot().finance!.transactions).toHaveLength(1);
  });
  it("rejects cross references, mismatched category kinds and impossible dates", async () => {
    const repo = await MobileRepository.open(new Disk()); const draft = entry(repo);
    await expect(repo.saveFinanceEntry({ ...draft, accountId: crypto.randomUUID() })).rejects.toThrow();
    await expect(repo.saveFinanceEntry({ ...draft, type: "income" })).rejects.toThrow();
    await expect(repo.saveFinanceEntry({ ...draft, date: "2026-02-30" })).rejects.toThrow();
    expect(repo.snapshot().finance!.transactions).toEqual([]);
  });
  it("exports financial content and invalidates the backup gate after changes", async () => {
    const repo = await MobileRepository.open(new Disk()); await repo.markBackup(0); await repo.saveFinanceEntry(entry(repo));
    expect(repo.snapshot().lastBackupSeq).toBeNull();
    const backup = portableBackupSchema.parse(JSON.parse(createPortableBackup(repo.snapshot())));
    expect(backup.local.finance!.transactions[0]!.totalAmount).toBe(12345);
    expect(backup.local.finance!.accounts[0]!.currency).toBe("RUB");
  });
});
