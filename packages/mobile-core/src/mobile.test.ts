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
