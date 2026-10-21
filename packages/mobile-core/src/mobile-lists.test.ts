import { expect, it } from "vitest";
import { MobileRepository, createPortableBackup, portableBackupSchema, type SnapshotStorage } from "./index";
import { syncOpSchema } from "@orion/shared-types";
class Disk implements SnapshotStorage {
  raw: string | null = null; fail = false;
  async read() { return this.raw; }
  async write(value: string) { if (this.fail) throw new Error("disk full"); this.raw = value; }
}
it("merges concurrent settings patches and preserves old data and identity", async () => {
  const disk = new Disk(); const repo = await MobileRepository.open(disk);
  await repo.saveEntry({ kind: "note", id: null, title: "Сохранить", body: "**Оригинал**", priority: "normal" });
  const before = repo.snapshot();
  await Promise.all([repo.patchSettings({ theme: "light" }), repo.patchSettings({ depthStrength: 95 }), repo.patchSettings({ autoCheckUpdates: false })]);
  const restarted = await MobileRepository.open(disk);
  expect(restarted.snapshot().settings).toMatchObject({ theme: "light", depthStrength: 95, autoCheckUpdates: false });
  expect(restarted.snapshot().notes).toEqual(before.notes); expect(restarted.snapshot().deviceId).toBe(before.deviceId);
  expect(restarted.snapshot().outbox).toEqual(before.outbox);
  const saved = disk.raw;
  await expect(repo.patchSettings({ depthStrength: 101 })).rejects.toThrow();
  await expect(repo.patchSettings({ token: "wrong" } as never)).rejects.toThrow(); expect(disk.raw).toBe(saved);
  disk.fail = true; const state = repo.snapshot(); await expect(repo.patchSettings({ theme: "dark" })).rejects.toThrow(); expect(repo.snapshot()).toEqual(state);
});
it("adds empty list defaults to old snapshots without overwriting records", async () => {
  const disk = new Disk(); const repo = await MobileRepository.open(disk); const before = repo.snapshot();
  const old = JSON.parse(disk.raw!); delete old.lists; delete old.listDrafts; disk.raw = JSON.stringify(old);
  expect((await MobileRepository.open(disk)).snapshot()).toEqual(before);
});
it("keeps list drafts, edits and checked state durable without losing entry metadata", async () => {
  const disk = new Disk(); const repo = await MobileRepository.open(disk); const list = crypto.randomUUID(); const item = crypto.randomUUID();
  await repo.mutateList({ entity: "list", kind: "create", id: list, fields: { name: "Покупки" } });
  await repo.mutateList({ entity: "listItem", kind: "create", id: item, parentId: list, fields: { label: "Молоко", quantity: 2, unit: "л", note: "Не потерять" } });
  const draft = { kind: "item" as const, id: item, parentId: list, text: "Новая подпись" };
  await repo.saveListDraft("phone", draft);
  await repo.mutateList({ entity: "listItem", kind: "patch", id: item, parentId: list, fields: { checked: true } });
  expect(repo.snapshot().listDrafts.phone).toEqual(draft);
  await repo.mutateList({ entity: "listItem", kind: "patch", id: item, parentId: list, fields: { label: draft.text } }, true);
  const restarted = await MobileRepository.open(disk);
  expect(restarted.snapshot().lists[0].items[0]).toMatchObject({ checked: true, label: draft.text, quantity: 2, unit: "л", note: "Не потерять" });
  expect(restarted.snapshot().listDrafts.phone).toBeUndefined();
  const backup = portableBackupSchema.parse(JSON.parse(createPortableBackup(restarted.snapshot())));
  expect(backup.local.lists).toEqual(restarted.snapshot().lists);
  for (const op of restarted.snapshot().outbox) expect(syncOpSchema.safeParse(op).success).toBe(true);
});
it("rejects wrong parents and does not publish failed delete; list delete cascades only to its items", async () => {
  const disk = new Disk(); const repo = await MobileRepository.open(disk); const list = crypto.randomUUID(); const other = crypto.randomUUID(); const item = crypto.randomUUID();
  await repo.mutateList({ entity: "list", kind: "create", id: list, fields: { name: "Удалить" } });
  await repo.mutateList({ entity: "list", kind: "create", id: other, fields: { name: "Оставить" } });
  await repo.mutateList({ entity: "listItem", kind: "create", id: item, parentId: list, fields: { label: "Пункт" } });
  await expect(repo.mutateList({ entity: "listItem", kind: "patch", id: item, parentId: other, fields: { checked: true } })).rejects.toThrow();
  await repo.saveListDraft("phone", { kind: "item", id: crypto.randomUUID(), parentId: list, text: "Черновик" });
  const before = repo.snapshot(); disk.fail = true;
  await expect(repo.mutateList({ entity: "list", kind: "delete", id: list })).rejects.toThrow(); expect(repo.snapshot()).toEqual(before);
  disk.fail = false; await repo.mutateList({ entity: "list", kind: "delete", id: list });
  expect(repo.snapshot().lists.map((record) => record.id)).toEqual([other]); expect(repo.snapshot().listDrafts.phone).toBeUndefined();
});
