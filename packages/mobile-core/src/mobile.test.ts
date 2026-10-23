import { describe, expect, it } from "vitest";
import { MobileRepository, lanProfileSchema, type Draft, type SnapshotStorage } from "./index";
import { syncOpSchema } from "@orion/shared-types";

class Disk implements SnapshotStorage {
  raw: string | null = null;
  fail = false;
  async read() { return this.raw; }
  async write(value: string) { if (this.fail) throw new Error("disk full"); this.raw = value; }
}
const draft = (kind: "task" | "note", title = "Запись"): Draft => ({
  kind, id: null, title, body: "**Markdown**\nТекст", priority: "normal",
});

describe("Android local repository", () => {
  it("keeps task planning fields durable and validates minutes without discarding drafts", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry({ ...draft("task"), startAt: "2026-11-01T12:00:00.000Z", estimatedMinutesText: "45" });
    const task = repo.snapshot().tasks[0];
    await repo.saveEntry({ ...draft("task", "Legacy"), id: task.id });
    expect(repo.snapshot().tasks[0]).toMatchObject({ startAt: task.startAt, estimatedMinutes: 45 });
    const invalid = { ...draft("task"), id: task.id, estimatedMinutesText: "1.5" };
    await repo.saveDraft(invalid); const before = repo.snapshot();
    await expect(repo.saveEntry(invalid)).rejects.toThrow("целое число"); expect(repo.snapshot()).toEqual(before);
    disk.fail = true;
    await expect(repo.saveEntry({ ...draft("task"), id: task.id, startAt: null, estimatedMinutesText: "" })).rejects.toThrow("disk full");
    expect(repo.snapshot()).toEqual(before); disk.fail = false;
    await repo.saveEntry({ ...draft("task"), id: task.id, startAt: null, estimatedMinutesText: "0" });
    expect((await MobileRepository.open(disk)).snapshot().tasks[0]).toMatchObject({ startAt: null, estimatedMinutes: 0 });
    await repo.saveEntry({ ...draft("task"), id: task.id, estimatedMinutesText: "" }); expect(repo.snapshot().tasks[0].estimatedMinutes).toBeNull();
  });
  it("preserves new fields, legacy drafts and invalid-tag input across durable saves", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry({ ...draft("task"), status: "in_progress", dueAt: "2026-11-02T12:30:00.000Z" });
    const task = repo.snapshot().tasks[0];
    await repo.saveEntry({ ...draft("task", "Legacy title"), id: task.id });
    expect(repo.snapshot().tasks[0]).toMatchObject({ status: "in_progress", dueAt: task.dueAt });
    await repo.saveEntry({ ...draft("task"), id: task.id, status: "canceled", dueAt: null });
    expect(repo.snapshot().tasks[0]).toMatchObject({ status: "canceled", dueAt: null });
    await repo.saveEntry({ ...draft("note"), summary: "Описание", tagsText: "идеи, работа, идеи, ", pinnedAt: "2026-10-21T12:00:00.000Z" });
    const note = repo.snapshot().notes[0];
    await repo.saveEntry({ ...draft("note", "Legacy note"), id: note.id });
    expect(repo.snapshot().notes[0]).toMatchObject({ summary: "Описание", tags: ["идеи", "работа"], pinnedAt: note.pinnedAt });
    const invalid = { ...draft("note", "Длинный тег"), tagsText: "x".repeat(41) };
    await repo.saveDraft(invalid); const before = repo.snapshot();
    await expect(repo.saveEntry(invalid)).rejects.toThrow("Не больше 20 тегов");
    expect(repo.snapshot()).toEqual(before);
    const reload = await MobileRepository.open(disk); expect(reload.snapshot().draft).toEqual(invalid);
    disk.fail = true;
    await expect(repo.saveEntry({ ...draft("note"), id: note.id, summary: "Не записано", tagsText: "", pinnedAt: null })).rejects.toThrow("disk full");
    expect(repo.snapshot()).toEqual(before);
    disk.fail = false; await repo.saveEntry({ ...draft("note"), id: note.id, summary: "", tagsText: "", pinnedAt: null });
    expect(repo.snapshot().notes[0]).toMatchObject({ summary: "", tags: [], pinnedAt: null });
  });
  it("stores task checklists as durable child tasks and cascades parent deletion", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry(draft("task", "Поездка"));
    const parent = repo.snapshot().tasks[0];
    await repo.addTaskChecklistItem(parent.id, "Проверить документы");
    const item = repo.snapshot().tasks.find((task) => task.parentId === parent.id)!;
    expect(item).toMatchObject({ title: "Проверить документы", status: "todo", parentId: parent.id });
    expect(repo.snapshot().outbox.slice(-1)[0]).toMatchObject({ entity: "task", kind: "create", fields: { parentId: parent.id } });

    const beforeFailure = repo.snapshot(); disk.fail = true;
    await expect(repo.addTaskChecklistItem(parent.id, "Не записалось")).rejects.toThrow("disk full");
    expect(repo.snapshot()).toEqual(beforeFailure);
    disk.fail = false;

    await repo.renameTaskChecklistItem(item.id, "Взять документы");
    await repo.setTaskDone(item.id, true);
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot().tasks.find((task) => task.id === item.id)).toMatchObject({ title: "Взять документы", status: "done", parentId: parent.id });
    await restarted.deleteEntry("task", parent.id);
    expect(restarted.snapshot().tasks).toEqual([]);
    expect(syncOpSchema.safeParse(restarted.snapshot().outbox.slice(-1)[0]).success).toBe(true);
  });

  it("creates a task together with its staged checklist in one durable write", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    const steps = [
      { id: crypto.randomUUID(), title: "  Документы  ", done: true },
      { id: crypto.randomUUID(), title: "Зарядка", done: false },
      { id: crypto.randomUUID(), title: "   ", done: false },
    ];
    await repo.saveEntry({ ...draft("task", "Поездка"), checklist: steps });
    const snapshot = repo.snapshot();
    const parent = snapshot.tasks.find((task) => !task.parentId)!;
    const children = snapshot.tasks.filter((task) => task.parentId === parent.id);
    expect(children.map((task) => [task.id, task.title, task.status, task.sortOrder])).toEqual([
      [steps[0].id, "Документы", "done", 10],
      [steps[1].id, "Зарядка", "todo", 20],
    ]);
    expect(snapshot.outbox.slice(-3).map((op) => [op.kind, op.entityId])).toEqual([
      ["create", parent.id], ["create", steps[0].id], ["create", steps[1].id],
    ]);
    expect(snapshot.draft).toBeNull();
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot().tasks).toHaveLength(3);

    const beforeFailure = restarted.snapshot(); disk.fail = true;
    await expect(restarted.saveEntry({ ...draft("task", "Не записалось"), checklist: [{ id: crypto.randomUUID(), title: "Пункт", done: false }] })).rejects.toThrow("disk full");
    expect(restarted.snapshot()).toEqual(beforeFailure);
    disk.fail = false;

    await expect(restarted.saveEntry({ ...draft("task", "Дубль"), checklist: [{ id: parent.id, title: "Чужой id", done: false }] })).rejects.toThrow("повторяет существующую");
    expect(restarted.snapshot().tasks).toHaveLength(3);
  });

  it("deletes only the chosen entry atomically and retains unrelated drafts and valid delete operations", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry(draft("task", "Удалить")); await repo.saveEntry(draft("note", "Оставить"));
    const task = repo.snapshot().tasks[0];
    await repo.saveTaskOrder("phone", [task.id]); await repo.saveDraft(draft("note", "Другой черновик"));
    const before = repo.snapshot(); disk.fail = true;
    await expect(repo.deleteEntry("task", task.id)).rejects.toThrow("disk full"); expect(repo.snapshot()).toEqual(before);
    disk.fail = false; await repo.deleteEntry("task", task.id);
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot().tasks).toHaveLength(0); expect(restarted.snapshot().notes).toEqual(before.notes);
    expect(restarted.snapshot().draft).toEqual(before.draft); expect(restarted.snapshot().taskOrder.phone).toEqual([]);
    expect(restarted.snapshot().outbox.slice(-1)[0]).toMatchObject({ entity: "task", entityId: task.id, kind: "delete", expectedRevision: 1 });
    expect(syncOpSchema.safeParse(restarted.snapshot().outbox.slice(-1)[0]).success).toBe(true);
    const note = restarted.snapshot().notes[0]; await restarted.saveDraft({ ...draft("note"), id: note.id });
    await restarted.deleteEntry("note", note.id); expect(restarted.snapshot().draft).toBeNull();
    await expect(restarted.deleteEntry("note", note.id)).rejects.toThrow("Запись не найдена");
  });

  it("persists entries, protocol operations, draft and device identity across restart", async () => {
    const disk = new Disk();
    const repo = await MobileRepository.open(disk);
    await repo.saveEntry(draft("task"));
    await repo.saveEntry(draft("note"));
    await repo.saveDraft(draft("note", "Черновик"));
    const restarted = await MobileRepository.open(disk);
    expect(restarted.snapshot()).toEqual(repo.snapshot());
    expect(restarted.snapshot().notes[0].body).toBe("**Markdown**\nТекст");
    for (const op of restarted.snapshot().outbox) expect(syncOpSchema.safeParse(op).success).toBe(true);
  });
  it("does not publish failed writes or lose the previous data; later writes recover", async () => {
    const disk = new Disk();
    const repo = await MobileRepository.open(disk);
    await repo.saveDraft(draft("note"));
    const before = repo.snapshot();
    disk.fail = true;
    await expect(repo.saveEntry(draft("note"))).rejects.toThrow("disk full");
    expect(repo.snapshot()).toEqual(before);
    disk.fail = false;
    await repo.saveEntry(draft("note"));
    expect(repo.snapshot().notes).toHaveLength(1);
    expect(repo.snapshot().deviceSeq).toBe(1);
  });
  it("serializes concurrent writes without losing entries or sequence numbers", async () => {
    const repo = await MobileRepository.open(new Disk());
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.saveEntry(draft("task", String(i)))));
    expect(repo.snapshot().tasks).toHaveLength(20);
    expect(repo.snapshot().outbox.map((op) => op.deviceSeq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it("retains markdown and increments CAS on edits and reversible archive", async () => {
    const repo = await MobileRepository.open(new Disk());
    await repo.saveEntry(draft("note"));
    const id = repo.snapshot().notes[0].id;
    await repo.saveEntry({ ...draft("note", "Правка"), id });
    await repo.archiveNote(id, true);
    await repo.archiveNote(id, false);
    expect(repo.snapshot().notes[0]).toMatchObject({ title: "Правка", revision: 4, archivedAt: null });
    expect(repo.snapshot().outbox.slice(1).map((op) => op.expectedRevision)).toEqual([1, 2, 3]);
  });
  it("does not overwrite corrupt or unknown-version storage", async () => {
    for (const raw of ["broken json", '{"version":99}']) {
      const disk = new Disk(); disk.raw = raw;
      await expect(MobileRepository.open(disk)).rejects.toThrow();
      expect(disk.raw).toBe(raw);
    }
  });
  it("rejects empty titles and missing entities without clearing draft", async () => {
    const repo = await MobileRepository.open(new Disk());
    await repo.saveDraft(draft("task", "  "));
    await expect(repo.saveEntry(draft("task", "  "))).rejects.toThrow();
    await expect(repo.setTaskDone(crypto.randomUUID(), true)).rejects.toThrow();
    expect(repo.snapshot().draft?.title).toBe("  ");
    expect(repo.snapshot().outbox).toHaveLength(0);
  });
  it("uses a monotonic clock even when physical time moves backwards", async () => {
    const disk = new Disk(); const repo = await MobileRepository.open(disk);
    await repo.saveEntry(draft("task"));
    const state = repo.snapshot(); state.clock.wallMs += 100000;
    disk.raw = JSON.stringify(state);
    const restored = await MobileRepository.open(disk);
    await restored.saveEntry(draft("task"));
    expect(restored.snapshot().clock.wallMs).toBe(state.clock.wallMs);
    expect(restored.snapshot().clock.counter).toBeGreaterThan(state.clock.counter);
  });
  it("validates LAN profiles without treating them as connections", () => {
    expect(lanProfileSchema.parse({ address: "192.168.1.20" }).port).toBe(4443);
    for (const address of ["https://host", "user:pass@host", "host/path", "a..b"]) {
      expect(lanProfileSchema.safeParse({ address }).success).toBe(false);
    }
    expect(lanProfileSchema.safeParse({ address: "pc", port: 65536 }).success).toBe(false);
  });
});
