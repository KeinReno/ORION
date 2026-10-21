import { describe, expect, it } from "vitest";
// Shared synthetic protocol host; test-only fixture, never part of the APK.
import { MemoryHost } from "../../core/src/sync/memory-host";
import { MobileRemoteClient, MobileRepository, createPortableBackup, parseMobileReplica, portableBackupSchema,
  prepareLocalImport, remoteScopeKey, type MobileReplicaEnvelope, type ReplicaIO, type RemoteScope, type SnapshotStorage } from "./index";

class LocalDisk implements SnapshotStorage {
  raw: string | null = null;
  async read() { return this.raw; }
  async write(raw: string) { this.raw = raw; }
}
class Copies implements ReplicaIO {
  data = new Map<string, string>(); fail = false;
  async read(key: string) { return this.data.get(key) ?? null; }
  async write(key: string, raw: string) { if (this.fail) throw new Error("disk full"); this.data.set(key, raw); }
  async clear(key: string) { this.data.delete(key); }
}
const scope: RemoteScope = { nodeId: "synthetic-node", fingerprint: "AA:BB", userId: "user", workspaceId: "ws" };
const draft = (title: string) => ({ kind: "note" as const, id: crypto.randomUUID(), title, body: "**Текст**", priority: "normal" as const });
async function connected(io = new Copies(), host = new MemoryHost()) {
  const client = await MobileRemoteClient.create(scope, io, host); await client.sync();
  return { client, io, host };
}
describe("Mobile remote replica and portable backup", () => {
  it("converges extended task/note fields without clearing them on legacy edits", async () => {
    const { client, io, host } = await connected();
    const note = { ...draft("Теги"), summary: "Кратко", tagsText: "mobile, идеи", pinnedAt: "2026-10-21T10:00:00.000Z" };
    const task = { ...draft("Срок"), kind: "task" as const, status: "in_progress" as const, dueAt: "2026-11-02T12:00:00.000Z" };
    await client.saveEntry(note); await client.saveEntry(task); await client.sync();
    host.nowMs += 1000;
    const observer = await MobileRemoteClient.create(scope, new Copies(), host); await observer.sync();
    expect(observer.engine.notes()[0]).toMatchObject({ summary: "Кратко", tags: ["mobile", "идеи"], pinnedAt: note.pinnedAt });
    expect(observer.engine.tasks()[0]).toMatchObject({ status: "in_progress", dueAt: task.dueAt });
    await observer.saveEntry({ ...draft("Legacy"), id: note.id }); await observer.sync(); await client.sync();
    expect(client.engine.notes()[0]).toMatchObject({ summary: "Кратко", tags: ["mobile", "идеи"] });
    io.fail = true;
    await expect(client.saveEntry({ ...note, tagsText: "changed" })).rejects.toThrow("disk full");
    expect(client.engine.notes()[0].tags).toEqual(["mobile", "идеи"]);
  });
  it("converges offline lists across two replicas and rejects list scope contamination", async () => {
    const { client, io, host } = await connected();
    const list = crypto.randomUUID(); const item = crypto.randomUUID();
    await client.mutateList({ entity: "list", kind: "create", id: list, fields: { name: "Сборы" } });
    await client.mutateList({ entity: "listItem", kind: "create", id: item, parentId: list, fields: { label: "Зарядка" } });
    const restarted = await MobileRemoteClient.create(scope, io, host); expect(restarted.engine.lists().lists[0].items).toHaveLength(1);
    await restarted.sync(); host.nowMs += 1000; const observer = await MobileRemoteClient.create(scope, new Copies(), host); await observer.sync();
    await observer.mutateList({ entity: "listItem", kind: "patch", id: item, parentId: list, fields: { checked: true } });
    await observer.sync(); await restarted.sync(); expect(restarted.engine.lists().lists[0].items[0].checked).toBe(true);
    const raw = JSON.parse(io.data.get(restarted.key)!); raw.replica.entities.list[list].workspaceId = "another-workspace";
    expect(() => parseMobileReplica(JSON.stringify(raw), scope)).toThrow();
    io.fail = true; await expect(restarted.mutateList({ entity: "list", kind: "delete", id: list })).rejects.toThrow("disk full");
    expect(restarted.engine.lists().lists).toHaveLength(1); io.fail = false;
    await restarted.mutateList({ entity: "list", kind: "delete", id: list }); await restarted.sync(); await observer.sync();
    expect(observer.engine.lists().lists).toHaveLength(0);
  });

  it("keeps deletion durable offline and converges through the existing public protocol", async () => {
    const { client, io, host } = await connected(); const note = draft("Удалить после синхронизации");
    await client.saveEntry(note); await client.sync();
    const observer = await MobileRemoteClient.create(scope, new Copies(), host); await observer.sync();
    expect(observer.engine.notes()).toHaveLength(1);
    io.fail = true;
    await expect(client.deleteEntry("note", note.id)).rejects.toThrow("disk full");
    expect(client.engine.notes()).toHaveLength(1);
    io.fail = false; await client.deleteEntry("note", note.id);
    const restarted = await MobileRemoteClient.create(scope, io, host);
    expect(restarted.engine.notes()).toHaveLength(0); expect(restarted.engine.status().pending).toBe(1);
    await restarted.sync(); await observer.sync(); expect(observer.engine.notes()).toHaveLength(0);
    await expect(restarted.deleteEntry("note", note.id)).rejects.toThrow("Запись не найдена");
  });

  it("keeps offline writes durable, restarts and retries lost acknowledgements without duplicates", async () => {
    const { client, io, host } = await connected();
    const note = draft("На телефоне без сети");
    await client.saveEntry(note);
    expect(client.engine.status().pending).toBe(1);
    const restarted = await MobileRemoteClient.create(scope, io, host);
    expect(restarted.engine.notes()[0].title).toBe(note.title);
    host.dropPushResponses = 1;
    await restarted.sync(); expect(restarted.engine.status().pending).toBe(1);
    await restarted.sync(); expect(restarted.engine.status().pending).toBe(0);
    expect([...host.rows.keys()].filter((key) => key.startsWith("note:"))).toHaveLength(1);
  });
  it("does not publish failed local writes, and preserves the previous durable copy", async () => {
    const { client, io } = await connected(); const before = io.data.get(client.key);
    io.fail = true;
    await expect(client.saveEntry(draft("Не записалось"))).rejects.toThrow("disk full");
    expect(client.engine.notes()).toHaveLength(0);
    expect(client.engine.pending()).toHaveLength(0); expect(io.data.get(client.key)).toBe(before);
    io.fail = false; await client.saveEntry(draft("Повтор")); expect(client.engine.notes()).toHaveLength(1);
  });
  it("detects a two-client note conflict and supports explicit retry against the new revision", async () => {
    const host = new MemoryHost();
    const { client: first } = await connected(new Copies(), host);
    const note = draft("Общая заметка"); await first.saveEntry(note); await first.sync();
    const { client: second } = await connected(new Copies(), host);
    const staleRevision = second.revision("note", note.id)!;
    await first.saveEntry({ ...note, body: "Правка ПК", expectedRevision: first.revision("note", note.id) }); await first.sync();
    await second.saveEntry({ ...note, body: "Правка телефона", expectedRevision: staleRevision }); await second.sync();
    expect(second.engine.conflicts()).toHaveLength(1);
    expect(second.engine.notes()[0].body).toBe("Правка ПК");
    expect(second.engine.conflicts()[0].op.fields?.body).toBe("Правка телефона");
    await second.retryConflict(second.engine.conflicts()[0].opId); await second.sync();
    await first.sync(); expect(first.engine.notes()[0].body).toBe("Правка телефона");
  });
  it("requires a current confirmed backup before copying local content", async () => {
    const { client } = await connected(); const local = await MobileRepository.open(new LocalDisk());
    await local.saveEntry({ ...draft("Локальная"), id: null });
    await expect(client.importLocal(local.snapshot())).rejects.toThrow("резервную");
    await local.markBackup(local.snapshot().deviceSeq);
    expect(await client.importLocal(local.snapshot())).toBe(1);
    await local.saveEntry({ ...draft("Ещё одна"), id: null });
    await expect(client.importLocal(local.snapshot())).rejects.toThrow("резервную");
  });
  it("commits import ledger and new device operations atomically; restart/repeat creates no copies", async () => {
    const { client, host, io } = await connected(); const local = await MobileRepository.open(new LocalDisk());
    await local.saveEntry({ ...draft("Оригинал"), id: null }); await local.markBackup(local.snapshot().deviceSeq);
    const original = local.snapshot();
    io.fail = true; await expect(client.importLocal(original)).rejects.toThrow("disk full");
    expect(client.engine.pending()).toHaveLength(0);
    io.fail = false; expect(await client.importLocal(original)).toBe(1);
    const restarted = await MobileRemoteClient.create(scope, io, host);
    expect(await restarted.importLocal(original)).toBe(0);
    expect(restarted.engine.pending()).toHaveLength(1);
    await restarted.sync();
    expect(restarted.engine.notes()).toHaveLength(1);
    expect(restarted.engine.notes()[0].workspaceId).toBe("ws");
    expect(restarted.engine.notes()[0].id).not.toBe(original.notes[0].id);
    expect(local.snapshot()).toEqual(original);
    const envelope = parseMobileReplica(io.data.get(client.key)!, scope);
    envelope.replica.entities.note = {};
    expect((await prepareLocalImport(envelope, original, scope)).count).toBe(0);
  });
  it("separates node, certificate, user and workspace scopes", async () => {
    const key = await remoteScopeKey(scope);
    for (const variant of [{ ...scope, nodeId: "other" }, { ...scope, fingerprint: "CC:DD" }, { ...scope, userId: "other" }, { ...scope, workspaceId: "other" }]) {
      expect(await remoteScopeKey(variant)).not.toBe(key);
      const { client, io } = await connected();
      expect(() => parseMobileReplica(io.data.get(client.key)!, variant)).toThrow();
    }
  });
  it("rejects corrupt and cross-workspace data instead of replacing it", async () => {
    const { client, io } = await connected();
    const raw = io.data.get(client.key)!;
    await client.saveEntry(draft("Заметка")); await client.sync();
    const envelope = JSON.parse(io.data.get(client.key)!) as MobileReplicaEnvelope;
    Object.values(envelope.replica.entities.note)[0].workspaceId = "foreign";
    expect(() => parseMobileReplica(JSON.stringify(envelope), scope)).toThrow();
    expect(() => parseMobileReplica('{"version":999}', scope)).toThrow();
    expect(io.data.get(client.key)).not.toBe(raw);
  });
  it("exports content/drafts without credentials or replayable device identity", async () => {
    const disk = new LocalDisk(); const local = await MobileRepository.open(disk);
    await local.saveEntry({ ...draft("Резервная заметка"), id: null });
    const snapshot = local.snapshot();
    const raw = createPortableBackup(snapshot);
    const backup = portableBackupSchema.parse(JSON.parse(raw));
    expect(backup.local.notes[0].body).toBe("**Текст**");
    expect(raw).not.toContain(snapshot.deviceId);
    for (const secret of ["accessToken", "refreshToken", "deviceToken", "deviceSeq", "outbox", "certificate"]) expect(raw).not.toContain(secret);
  });
  it("revocation removes only the remote copy; independent phone records remain", async () => {
    const { client, host, io } = await connected();
    const local = await MobileRepository.open(new LocalDisk()); await local.saveEntry({ ...draft("Только телефон"), id: null });
    host.revoked = true; await client.sync();
    expect(client.engine.status().phase).toBe("revoked");
    expect(io.data.has(client.key)).toBe(false);
    expect(local.snapshot().notes[0].title).toBe("Только телефон");
  });
});
