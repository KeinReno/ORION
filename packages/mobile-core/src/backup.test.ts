import { describe, expect, it } from "vitest";
import { MobileRepository, createPortableBackup, inspectPortableBackup, localDate, type FinanceDraft, type SnapshotStorage } from "./index";

class Disk implements SnapshotStorage {
  raw: string | null = null;
  fail = false;
  async read() { return this.raw; }
  async write(value: string) { if (this.fail) throw new Error("disk full"); this.raw = value; }
}

const draft = (title: string) => ({ kind: "note" as const, id: null, title, body: "Черновик", priority: "normal" as const });
function expense(repo: MobileRepository, note: string): FinanceDraft {
  const finance = repo.snapshot().finance!;
  return {
    dateMode: "custom", id: crypto.randomUUID(), type: "expense", amount: "120,50",
    accountId: finance.accounts[0]!.id, categoryId: finance.categories.find((item) => item.kind === "expense")!.id,
    date: localDate(), note,
  };
}

async function createSource(): Promise<string> {
  const repo = await MobileRepository.open(new Disk());
  await repo.saveEntry({ kind: "task", id: null, title: "Поездка", body: "Собрать вещи", priority: "normal" });
  const parent = repo.snapshot().tasks[0]!;
  await repo.addTaskChecklistItem(parent.id, "Документы");
  await repo.saveEntry({ kind: "task", id: null, title: "Отдельная задача", body: "", priority: "low" });
  await repo.saveEntry({ kind: "note", id: null, title: "Список покупок", body: "**Молоко**", priority: "normal" });
  const list = crypto.randomUUID();
  await repo.mutateList({ entity: "list", kind: "create", id: list, fields: { name: "Продукты" } });
  await repo.mutateList({ entity: "listItem", kind: "create", id: crypto.randomUUID(), parentId: list, fields: { label: "Молоко", quantity: 2, unit: "л" } });
  await repo.saveFinanceEntry(expense(repo, "Обед"));
  await repo.saveDraft(draft("Незавершённая заметка из копии"));
  return createPortableBackup(repo.snapshot());
}

async function createTarget(): Promise<{ repo: MobileRepository; disk: Disk }> {
  const disk = new Disk(); const repo = await MobileRepository.open(disk);
  await repo.patchSettings({ theme: "dark", depthStrength: 87 });
  await repo.setRemote({ nodeId: "pc", fingerprint: "aa", userId: "user", workspaceId: "pc-workspace", workspaceName: "Дом" }, true);
  await repo.saveEntry({ kind: "task", id: null, title: "Только на телефоне", body: "", priority: "normal" });
  await repo.saveEntry({ kind: "note", id: null, title: "Заметка телефона", body: "", priority: "normal" });
  await repo.saveDraft(draft("Текущий незавершённый ввод"));
  await repo.saveTaskOrder("phone", repo.snapshot().tasks.map((task) => task.id));
  await repo.markBackup(repo.snapshot().deviceSeq);
  return { repo, disk };
}

describe("portable backup restore", () => {
  it("previews counts without changing the file and rejects foreign or broken content", async () => {
    const raw = await createSource();
    const inspection = inspectPortableBackup(raw);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.preview).toMatchObject({ tasks: 3, notes: 1, lists: 1, listItems: 1, financeTransactions: 1 });
    expect(inspection.preview.createdAt).toBe(JSON.parse(raw).createdAt);
    expect(inspectPortableBackup("")).toMatchObject({ ok: false });
    expect(inspectPortableBackup("not json")).toMatchObject({ ok: false });
    expect(inspectPortableBackup(JSON.stringify({ format: "other", version: 1 }))).toMatchObject({ ok: false });

    const child = JSON.parse(raw);
    const item = child.local.tasks.find((task: { parentId: string | null }) => task.parentId);
    item.parentId = crypto.randomUUID();
    expect(inspectPortableBackup(JSON.stringify(child))).toMatchObject({ ok: false, error: expect.stringContaining("отсутствующую задачу") });

    const list = JSON.parse(raw);
    list.local.lists[0].items[0].listId = crypto.randomUUID();
    expect(inspectPortableBackup(JSON.stringify(list))).toMatchObject({ ok: false, error: expect.stringContaining("другому списку") });

    const finance = JSON.parse(raw);
    finance.local.finance.transactions[0].accountId = crypto.randomUUID();
    expect(inspectPortableBackup(JSON.stringify(finance))).toMatchObject({ ok: false, error: expect.stringContaining("отсутствующий счёт") });

    const duplicate = JSON.parse(raw);
    duplicate.local.tasks.push({ ...duplicate.local.tasks[0] });
    expect(inspectPortableBackup(JSON.stringify(duplicate))).toMatchObject({ ok: false, error: expect.stringContaining("повторяются") });
  });

  it("merges missing records into the current workspace and never overwrites an existing id", async () => {
    const raw = await createSource();
    const { repo, disk } = await createTarget();
    const before = repo.snapshot();
    const result = await repo.restoreBackup(raw, "merge");
    const state = repo.snapshot();
    expect(result).toMatchObject({ mode: "merge", tasks: 3, notes: 1, lists: 1, listItems: 1, skipped: 0 });
    expect(state.tasks).toHaveLength(4);
    expect(state.notes).toHaveLength(2);
    expect(state.lists).toHaveLength(1);
    expect(state.tasks.every((task) => task.workspaceId === state.workspaceId)).toBe(true);
    expect(state.notes.every((note) => note.workspaceId === state.workspaceId)).toBe(true);
    expect(state.lists.every((list) => list.workspaceId === state.workspaceId)).toBe(true);
    expect(state.deviceId).toBe(before.deviceId);
    expect(state.workspaceId).toBe(before.workspaceId);
    expect(state.settings.theme).toBe("dark");
    expect(state.remoteSelection?.nodeId).toBe("pc");
    expect(state.draft?.title).toBe("Текущий незавершённый ввод");
    expect(state.taskOrder.phone).toEqual(before.taskOrder.phone);
    expect(state.outbox).toEqual(before.outbox);
    expect(state.lastBackupSeq).toBeNull();
    expect(state.finance!.transactions).toHaveLength(1);
    expect(state.finance!.transactions[0]!.workspaceId).toBe(state.workspaceId);
    const importedTask = state.tasks.find((task) => task.title === "Отдельная задача")!;
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot()).toEqual(state);
    expect(restarted.snapshot().tasks.find((task) => task.id === importedTask.id)).toMatchObject({ title: "Отдельная задача" });

    const again = await repo.restoreBackup(raw, "merge");
    expect(again.tasks).toBe(0); expect(again.notes).toBe(0); expect(again.lists).toBe(0);
    expect(again.financeTransactions).toBe(0);
    expect(again.skipped).toBeGreaterThan(0);
  });

  it("replaces local records and finance atomically while preserving identity, pairing and settings", async () => {
    const raw = await createSource();
    const { repo, disk } = await createTarget();
    const before = repo.snapshot();
    const remoteScope = "a".repeat(64);
    const remoteTaskId = crypto.randomUUID();
    await repo.saveTaskOrder(remoteScope, [remoteTaskId]);
    const result = await repo.restoreBackup(raw, "replace");
    const state = repo.snapshot();
    expect(result).toMatchObject({ mode: "replace", tasks: 3, notes: 1, lists: 1, listItems: 1, financeTransactions: 1 });
    expect(result.outboxCleared).toBeGreaterThan(0);
    expect(state.tasks.map((task) => task.title).sort()).toEqual(["Документы", "Отдельная задача", "Поездка"]);
    expect(state.notes.map((note) => note.title)).toEqual(["Список покупок"]);
    expect(state.lists[0]!.items[0]).toMatchObject({ label: "Молоко", quantity: 2 });
    expect(state.outbox).toEqual([]);
    expect(state.taskOrder.phone).toEqual([]);
    expect(state.taskOrder[remoteScope]).toEqual([remoteTaskId]);
    expect(state.lastBackupSeq).toBeNull();
    expect(state.deviceId).toBe(before.deviceId);
    expect(state.workspaceId).toBe(before.workspaceId);
    expect(state.settings).toEqual(before.settings);
    expect(state.remoteSelection).toEqual(before.remoteSelection);
    expect(state.remoteActive).toBe(true);
    expect(state.draft?.title).toBe("Текущий незавершённый ввод");
    expect(state.finance!.transactions).toHaveLength(1);
    expect(state.finance!.transactions[0]!.workspaceId).toBe(state.workspaceId);
    expect(state.finance!.accounts.every((account) => account.workspaceId === state.workspaceId)).toBe(true);
    expect(state.tasks.every((task) => task.workspaceId === state.workspaceId)).toBe(true);
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot()).toEqual(state);
  });

  it("keeps the previous snapshot when a restore fails to write", async () => {
    const raw = await createSource();
    const { repo, disk } = await createTarget();
    const before = repo.snapshot();
    const saved = disk.raw;
    disk.fail = true;
    await expect(repo.restoreBackup(raw, "replace")).rejects.toThrow("disk full");
    expect(repo.snapshot()).toEqual(before);
    expect(disk.raw).toBe(saved);
    disk.fail = false;
    await expect(repo.restoreBackup("broken", "merge")).rejects.toThrow("не похож");
    expect(repo.snapshot()).toEqual(before);
  });
});
