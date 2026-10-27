import { prepareListMutation, type MobileListMutation } from "./mobile-lists";
import { ReplicaEngine, type ReplicaState, type ReplicaStorage, type SyncTransport } from "@orion/core";
import { parseMobileReplica, prepareLocalImport, remoteScopeKey, type MobileReplicaEnvelope, type RemoteScope } from "./mobile-replica";
import { draftSchema, entryFields, pendingChecklistItems, type Draft } from "./mobile-models";
import type { MobileSnapshot } from "./index";

export interface ReplicaIO {
  read(scope: string): Promise<string | null>;
  write(scope: string, value: string): Promise<void>;
  clear(scope: string): Promise<void>;
}
class DurableReplicaStorage implements ReplicaStorage {
  envelope: MobileReplicaEnvelope | null = null;
  saveFailed = false;
  constructor(readonly scope: RemoteScope, readonly key: string, readonly io: ReplicaIO) {}
  async load(): Promise<ReplicaState | null> {
    const raw = await this.io.read(this.key);
    this.envelope = raw ? parseMobileReplica(raw, this.scope) : null;
    this.saveFailed = false;
    return this.envelope ? structuredClone(this.envelope.replica) : null;
  }
  async save(state: ReplicaState): Promise<void> {
    const next: MobileReplicaEnvelope = { version: 1, scope: this.scope, replica: structuredClone(state), imported: this.envelope?.imported ?? {} };
    try {
      const raw = JSON.stringify(next);
      parseMobileReplica(raw, this.scope);
      if (new TextEncoder().encode(raw).byteLength > 16 * 1024 * 1024) throw new Error("Локальная копия слишком велика для этой alpha");
      await this.io.write(this.key, raw);
      this.envelope = structuredClone(next); this.saveFailed = false;
    } catch (error) { this.saveFailed = true; throw error; }
  }
  async clear(): Promise<void> { await this.io.clear(this.key); this.envelope = null; }
}

export class MobileRemoteClient {
  private networking = false;
  private importing = false;
  private constructor(readonly scope: RemoteScope, readonly key: string,
    readonly engine: ReplicaEngine, private readonly storage: DurableReplicaStorage) {}
  static async create(scope: RemoteScope, io: ReplicaIO, transport: SyncTransport): Promise<MobileRemoteClient> {
    const key = await remoteScopeKey(scope);
    const storage = new DurableReplicaStorage(scope, key, io);
    const engine = new ReplicaEngine({ storage, transport, userId: scope.userId, workspaceId: scope.workspaceId, deviceName: "KAIDEN Orion Android" });
    await engine.open();
    return new MobileRemoteClient(scope, key, engine, storage);
  }
  async sync(): Promise<void> {
    if (this.networking || this.importing) return;
    this.networking = true;
    try {
      await this.engine.sync();
      if (this.storage.saveFailed && this.engine.status().phase !== "revoked") await this.engine.open();
    } finally { this.networking = false; }
  }
  hasModule(entity: "task" | "note" | "list" | "listItem"): boolean { return this.storage.envelope?.replica.included.includes(entity) ?? false; }
  revision(entity: "task" | "note", id: string): number | undefined {
    const canonical = this.storage.envelope?.replica.entities[entity][id];
    const created = this.engine.pending().some((entry) => entry.op.entity === entity && entry.op.entityId === id && entry.op.kind === "create");
    const base = typeof canonical?.revision === "number" ? canonical.revision : created ? 1 : undefined;
    return base === undefined ? undefined : base + this.engine.pending().filter((entry) => entry.op.entity === entity && entry.op.entityId === id && entry.op.kind === "patch").length;
  }
  private async write(work: () => Promise<unknown>): Promise<void> {
    if (this.importing) throw new Error("Дождитесь завершения переноса записей");
    try { await work(); }
    catch (error) { if (this.storage.saveFailed) await this.engine.open(); throw error; }
  }
  async saveEntry(draft: Draft): Promise<void> {
    if (!this.storage.envelope?.replica.included.includes(draft.kind)) throw new Error("Этот модуль недоступен в пространстве компьютера");
    const parsed = draftSchema.parse(draft);
    const id = parsed.id ?? crypto.randomUUID();
    const fields = entryFields(parsed);
    const staged = parsed.kind === "task" ? pendingChecklistItems(parsed.checklist) : [];
    // Invalid rows are rejected before the parent is queued, so a failed save leaves no half-entry.
    const seen = new Set<string>();
    for (const item of staged) {
      const current = this.engine.entities().task[item.id];
      if (item.id === id || seen.has(item.id) || (current && current.parentId !== id)) {
        throw new Error("Пункт чек-листа повторяет существующую запись. Удалите его и добавьте снова.");
      }
      seen.add(item.id);
    }
    await this.write(async () => {
      const existing = this.engine.entities()[parsed.kind][id];
      await this.engine.enqueue({ entity: parsed.kind, entityId: id, kind: existing ? "patch" : "create", fields,
        ...(existing ? { expectedRevision: parsed.expectedRevision ?? this.revision(parsed.kind, id) } : {}) });
      // Staged rows are queued after their parent. Stable row ids make a retry after a partial
      // disk failure skip rows that already reached the queue instead of duplicating them.
      for (const item of staged) {
        const current = this.engine.entities().task[item.id];
        if (current) {
          if (current.parentId !== id) throw new Error("Пункт чек-листа повторяет существующую запись. Удалите его и добавьте снова.");
          continue;
        }
        const siblings = Object.values(this.engine.entities().task).filter((task) => task.parentId === id);
        const sortOrder = siblings.reduce((max, task) => Math.max(max, typeof task.sortOrder === "number" ? task.sortOrder : 0), 0) + 10;
        await this.engine.enqueue({ entity: "task", entityId: item.id, kind: "create",
          fields: { title: item.title, description: "", priority: "normal", parentId: id, sortOrder, ...(item.done ? { status: "done" } : {}) } });
      }
    });
  }
  async addTaskChecklistItem(parentId: string, title: string): Promise<void> {
    if (!this.hasModule("task")) throw new Error("Задачи недоступны в копии пространства");
    const clean = checklistTitle(title);
    const tasks = Object.values(this.engine.entities().task);
    if (!tasks.some((task) => task.id === parentId)) throw new Error("Родительская задача не найдена. Вернитесь к списку.");
    const siblings = tasks.filter((task) => task.parentId === parentId);
    const sortOrder = siblings.reduce((max, task) => Math.max(max, typeof task.sortOrder === "number" ? task.sortOrder : 0), 0) + 10;
    await this.write(() => this.engine.enqueue({ entity: "task", kind: "create", fields: { title: clean, description: "", priority: "normal", parentId, sortOrder } }));
  }
  async renameTaskChecklistItem(id: string, title: string): Promise<void> {
    const task = this.engine.entities().task[id];
    if (!task || typeof task.parentId !== "string") throw new Error("Пункт чек-листа не найден. Вернитесь к списку.");
    const clean = checklistTitle(title);
    await this.write(() => this.engine.enqueue({ entity: "task", entityId: id, kind: "patch", fields: { title: clean }, expectedRevision: this.revision("task", id) }));
  }
  async setTaskDone(id: string, done: boolean): Promise<void> {
    await this.write(() => this.engine.enqueue({ entity: "task", entityId: id, kind: "patch", fields: { status: done ? "done" : "todo" }, expectedRevision: this.revision("task", id) }));
  }
  async setNotePinned(id: string, pinned: boolean): Promise<void> {
    await this.write(() => this.engine.enqueue({ entity: "note", entityId: id, kind: "patch", fields: { pinnedAt: pinned ? new Date().toISOString() : null }, expectedRevision: this.revision("note", id) }));
  }
  async archiveNote(id: string, archived: boolean): Promise<void> {
    await this.write(() => this.engine.enqueue({ entity: "note", entityId: id, kind: "patch", fields: { archivedAt: archived ? new Date().toISOString() : null }, expectedRevision: this.revision("note", id) }));
  }
  async deleteEntry(entity: "task" | "note", id: string): Promise<void> {
    if (!this.hasModule(entity)) throw new Error("Этот модуль недоступен в пространстве компьютера");
    const revision = this.revision(entity, id);
    if (revision === undefined) throw new Error("Запись не найдена. Вернитесь к списку.");
    await this.write(() => this.engine.enqueue({ entity, entityId: id, kind: "delete", expectedRevision: revision }));
  }
  async mutateList(mutation: MobileListMutation): Promise<void> {
    if (!this.hasModule(mutation.entity)) throw new Error("Списки недоступны в копии пространства");
    const command = prepareListMutation(this.engine.lists().lists, mutation);
    await this.write(() => this.engine.enqueue(command));
  }
  async importLocal(source: MobileSnapshot): Promise<number> {
    if (this.networking || this.importing) throw new Error("Дождитесь завершения текущей синхронизации");
    if (!this.storage.envelope) throw new Error("Сначала загрузите копию пространства");
    this.importing = true;
    try {
      const prepared = await prepareLocalImport(this.storage.envelope, source, this.scope);
      await this.storage.io.write(this.key, JSON.stringify(prepared.envelope));
      await this.engine.open();
      return prepared.count;
    } finally { this.importing = false; }
  }
  async dismissConflict(id: string): Promise<void> { await this.write(() => this.engine.dismissConflict(id)); }
  async retryConflict(id: string): Promise<void> { await this.write(() => this.engine.retryConflict(id)); }
}

function checklistTitle(title: string): string {
  const clean = title.trim();
  if (!clean) throw new Error("Название пункта не может быть пустым.");
  if (clean.length > 200) throw new Error("Название пункта длиннее 200 символов.");
  return clean;
}
