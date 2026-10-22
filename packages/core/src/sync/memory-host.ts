import {
  SYNC_PROTOCOL_VERSION,
  canonicalOpBody,
  decideOp,
  formatHlc,
  type MergeEntityState,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaChange,
  type ReplicaPull,
  type ReplicaSnapshot,
  type SyncEntityType,
  type SyncOpResult
} from "@orion/shared-types";
import type { SyncTransport } from "./replica-types";

interface Row {
  fields: Record<string, unknown>;
  stamps: Record<string, string>;
  parentId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  revision: number;
}

/**
 * Узел в памяти для тестов клиента и теста сходимости. Решения принимает ТА ЖЕ `decideOp`, что и
 * Postgres-служба (`apps/api/src/sync/sync-host.service.ts`); лента изменений — состояние-ориентированная,
 * как на сервере: хранит «что тронуто», а `pull` отдаёт текущее состояние строк.
 */
export class MemoryHost implements SyncTransport {
  readonly rows = new Map<string, Row>();
  private readonly tombstones = new Set<string>();
  private readonly feed: Array<{ seq: number; key: string; entity: SyncEntityType; id: string; parentId: string | null }> = [];
  private readonly opLedger = new Map<string, { hash: string; result: SyncOpResult }>();
  private readonly deviceSeqs = new Map<string, string>();
  readonly devices = new Set<string>();
  private seq = 0;
  nowMs = 1_800_000_000_000;
  /** Отказ от членства: любой вызов даёт 403. */
  revoked = false;
  /** Следующие N вызовов `push` теряют ответ (операции применены, клиент ответа не получил). */
  dropPushResponses = 0;
  /** Следующие N вызовов бросают сетевую ошибку ДО обработки. */
  failNext = 0;
  /** Минимальный курсор; всё, что старше, требует `resync_required`. */
  minCursor = 0;
  /** Сколько изменений отдавать за один pull. */
  pullLimit = 500;

  private key(entity: SyncEntityType, id: string): string {
    return `${entity}:${id}`;
  }

  private guard(): void {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new TypeError("fetch failed");
    }
    if (this.revoked) throw Object.assign(new Error("Нет доступа"), { status: 403, details: { code: "forbidden" } });
  }

  async registerDevice(input: RegisterSyncDeviceInput): Promise<void> {
    this.guard();
    this.devices.add(input.deviceId);
  }

  async snapshot(): Promise<ReplicaSnapshot> {
    this.guard();
    const entities = { list: [] as unknown[], listItem: [] as unknown[], note: [] as unknown[], task: [] as unknown[] };
    for (const [key, row] of this.rows) {
      const [entity, id] = key.split(":") as [SyncEntityType, string];
      if (entity === "list") entities.list.push(this.doc(entity, id, row));
      if (entity === "listItem") entities.listItem.push(this.doc(entity, id, row));
      if (entity === "note") entities.note.push(this.doc(entity, id, row));
      if (entity === "task") entities.task.push(this.doc(entity, id, row));
    }
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      workspaceId: "ws",
      asOf: new Date(this.nowMs).toISOString(),
      cursor: String(this.seq),
      serverHlc: formatHlc({ wallMs: this.nowMs, counter: 0, deviceId: "host" }),
      included: ["list", "listItem", "note", "task"],
      entities: entities as ReplicaSnapshot["entities"]
    };
  }

  async pull(_workspaceId: string, cursor: string): Promise<ReplicaPull> {
    this.guard();
    const since = Number(cursor || 0);
    if (since < this.minCursor) throw Object.assign(new Error("Нужна полная загрузка"), { status: 410, details: { code: "resync_required" } });
    const fresh = this.feed.filter((entry) => entry.seq > since);
    const page = fresh.slice(0, this.pullLimit);
    const last = page.length > 0 ? (page[page.length - 1] as { seq: number }).seq : since;
    const latest = new Map<string, (typeof page)[number]>();
    for (const entry of page) latest.set(entry.key, entry);
    const changes: ReplicaChange[] = [...latest.values()].map((entry) => {
      const row = this.rows.get(entry.key);
      return { entity: entry.entity, id: entry.id, parentId: entry.parentId, doc: row ? this.doc(entry.entity, entry.id, row) : null };
    });
    return {
      protocol: SYNC_PROTOCOL_VERSION,
      asOf: new Date(this.nowMs).toISOString(),
      cursor: String(last),
      serverHlc: formatHlc({ wallMs: this.nowMs, counter: 0, deviceId: "host" }),
      hasMore: fresh.length > page.length,
      changes
    };
  }

  async push(_workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult> {
    this.guard();
    if (!this.devices.has(input.deviceId)) {
      throw Object.assign(new Error("Устройство не зарегистрировано"), { status: 409, details: { code: "device_unknown" } });
    }
    const results: SyncOpResult[] = [];
    for (const op of input.ops) {
      const hash = canonicalOpBody(op);
      const known = this.opLedger.get(op.opId);
      if (known) {
        results.push(known.hash === hash ? known.result : { opId: op.opId, outcome: "rejected", reason: "op_id_reuse" });
        continue;
      }
      const seqKey = `${op.deviceId}:${op.deviceSeq}`;
      const owner = this.deviceSeqs.get(seqKey);
      if (owner && owner !== op.opId) {
        results.push({ opId: op.opId, outcome: "rejected", reason: "device_rolled_back" });
        continue;
      }
      const result = this.applyOne(op);
      this.opLedger.set(op.opId, { hash, result });
      this.deviceSeqs.set(seqKey, op.opId);
      results.push(result);
    }
    const response: PushSyncOpsResult = {
      protocol: SYNC_PROTOCOL_VERSION,
      results,
      serverHlc: formatHlc({ wallMs: this.nowMs, counter: 0, deviceId: "host" })
    };
    if (this.dropPushResponses > 0) {
      this.dropPushResponses -= 1;
      throw new TypeError("fetch failed");
    }
    return response;
  }

  private applyOne(op: PushSyncOpsInput["ops"][number]): SyncOpResult {
    const key = this.key(op.entity, op.entityId);
    const row = this.rows.get(key);
    const state: MergeEntityState = {
      exists: Boolean(row),
      deleted: !row && this.tombstones.has(key),
      stamps: row?.stamps ?? {},
      updatedAtMs: row?.updatedAtMs ?? 0,
      fields: row?.fields ?? {},
      ...(row ? { revision: row.revision } : {})
    };
    const relationParentId = op.entity === "listItem" ? op.parentId : op.entity === "task" && typeof op.fields?.parentId === "string" ? op.fields.parentId : undefined;
    const parentEntity = op.entity === "listItem" ? "list" : "task";
    const parentRow = relationParentId ? this.rows.get(this.key(parentEntity, relationParentId)) : undefined;
    const parent = relationParentId
      ? { exists: Boolean(parentRow), deleted: !parentRow && this.tombstones.has(this.key(parentEntity, relationParentId)) }
      : null;
    const decision = decideOp(op, state, parent, this.nowMs);
    const result: SyncOpResult = {
      opId: op.opId,
      outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.lost ? { lost: decision.lost } : {})
    };
    if (decision.create) {
      const relationParentId = op.entity === "listItem" ? op.parentId ?? null : op.entity === "task" && typeof decision.create.parentId === "string" ? decision.create.parentId : null;
      this.rows.set(key, {
        fields: { ...decision.create },
        stamps: { ...(decision.stamps ?? {}) },
        parentId: relationParentId,
        createdAtMs: this.nowMs,
        updatedAtMs: this.nowMs,
        revision: 1
      });
      this.touch(op.entity, op.entityId, relationParentId);
    } else if (decision.set && row && Object.keys(decision.set).length > 0) {
      Object.assign(row.fields, decision.set);
      if (op.entity === "task" && "parentId" in decision.set) row.parentId = typeof decision.set.parentId === "string" ? decision.set.parentId : null;
      Object.assign(row.stamps, decision.stamps);
      row.updatedAtMs = this.nowMs;
      row.revision += 1;
      this.touch(op.entity, op.entityId, row.parentId);
    } else if (decision.remove && row) {
      this.rows.delete(key);
      this.tombstones.add(key);
      this.touch(op.entity, op.entityId, row.parentId);
      if (op.entity === "list") this.removeChildren("listItem", op.entityId);
      if (op.entity === "task") this.removeChildren("task", op.entityId);
    }
    return result;
  }

  /** Запись «в обход sync» — как обычный REST: без штампов, `updatedAt` = сейчас. */
  restWrite(entity: SyncEntityType, id: string, fields: Record<string, unknown>, parentId: string | null = null): void {
    const key = this.key(entity, id);
    const row = this.rows.get(key);
    if (row) {
      Object.assign(row.fields, fields);
      // Запись мимо sync обесценивает штампы затронутых полей (как триггер БД): дальше они сравниваются по updatedAt.
      for (const name of Object.keys(fields)) delete row.stamps[name];
      row.updatedAtMs = this.nowMs;
      row.revision += 1;
    } else {
      this.rows.set(key, { fields: { ...fields }, stamps: {}, parentId, createdAtMs: this.nowMs, updatedAtMs: this.nowMs, revision: 1 });
    }
    this.touch(entity, id, parentId ?? row?.parentId ?? null);
  }

  restDelete(entity: SyncEntityType, id: string): void {
    const key = this.key(entity, id);
    const row = this.rows.get(key);
    if (!row) return;
    this.rows.delete(key);
    this.tombstones.add(key);
    this.touch(entity, id, row.parentId);
    if (entity === "list") this.removeChildren("listItem", id);
    if (entity === "task") this.removeChildren("task", id);
  }

  private removeChildren(entity: "listItem" | "task", parentId: string): void {
    for (const [childKey, child] of [...this.rows]) {
      if (childKey.startsWith(`${entity}:`) && child.parentId === parentId) {
        const childId = childKey.slice(entity.length + 1);
        this.rows.delete(childKey);
        this.tombstones.add(childKey);
        this.touch(entity, childId, parentId);
        if (entity === "task") this.removeChildren("task", childId);
      }
    }
  }

  private touch(entity: SyncEntityType, id: string, parentId: string | null): void {
    this.seq += 1;
    this.feed.push({ seq: this.seq, key: this.key(entity, id), entity, id, parentId });
  }

  private doc(entity: SyncEntityType, id: string, row: Row): Record<string, unknown> {
    const iso = (ms: number) => new Date(ms).toISOString();
    if (entity === "list") {
      return { id, workspaceId: "ws", name: "", kind: "general", isTemplate: false, sortOrder: 0, archivedAt: null, ...row.fields, createdAt: iso(row.createdAtMs), updatedAt: iso(row.updatedAtMs) };
    }
    if (entity === "note") {
      return {
        id, workspaceId: "ws", projectId: null, number: null, summary: "", body: "", tags: [], pinnedAt: null, eventAt: null,
        editedAt: null, deletedAt: null, archivedAt: null, dailyOn: null, isTemplate: false, title: "", ...row.fields,
        revision: row.revision, createdAt: iso(row.createdAtMs), updatedAt: iso(row.updatedAtMs)
      };
    }
    if (entity === "task") {
      return {
        id, workspaceId: "ws", projectId: null, parentId: null, title: "", description: "", status: "todo", priority: "normal",
        dueAt: null, projectTag: null, recurrence: null, completedAt: null, sortOrder: 0, dependencyIds: [], blocked: false,
        assigneeId: null, startAt: null, estimatedMinutes: null, milestoneId: null, ...row.fields,
        revision: row.revision, createdAt: iso(row.createdAtMs), updatedAt: iso(row.updatedAtMs)
      };
    }
    return {
      id, listId: row.parentId, label: "", checked: false, sortOrder: 0, inventoryItemId: null, quantity: 1, unit: null, note: "",
      dueAt: null, section: null, priceMinor: null, stocked: false, expenseTransactionId: null, checkedAt: null, checkedById: null,
      checkedByName: null, ...row.fields, createdAt: iso(row.createdAtMs), updatedAt: iso(row.updatedAtMs)
    };
  }

  /** Каноническое состояние узла — то, к чему обязаны сойтись все реплики. */
  canonical(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, row] of [...this.rows].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [entity, id] = key.split(":") as [SyncEntityType, string];
      const { createdAt: _c, updatedAt: _u, ...rest } = this.doc(entity, id, row);
      out[key] = rest;
    }
    return out;
  }
}
