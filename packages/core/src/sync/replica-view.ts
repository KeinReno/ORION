import {
  SYNC_ENTITY_TYPES,
  type List,
  type ListItem,
  type SyncEntityType,
  type SyncOp,
  type SyncState
} from "@orion/shared-types";
import type { EntityDocs, PendingOp, ReplicaConflict, ReplicaEntityMap, ReplicaState, SyncStateMap } from "./replica-types";

export function emptyEntities(): ReplicaEntityMap {
  return Object.fromEntries(SYNC_ENTITY_TYPES.map((type) => [type, {}])) as unknown as ReplicaEntityMap;
}

export function cloneEntities(entities: ReplicaEntityMap): ReplicaEntityMap {
  const out = emptyEntities();
  for (const type of SYNC_ENTITY_TYPES) {
    for (const [id, doc] of Object.entries(entities[type] ?? {})) out[type][id] = { ...doc };
  }
  return out;
}

interface OverlayContext {
  userId: string;
  workspaceId: string;
  userName: string | null;
}

/**
 * Применяет операцию к документам копии «оптимистично» — так, как её увидит автор до ответа узла. Это
 * не слияние: правила победителя живут только на узле (`decideOp`), а здесь операция просто выигрывает
 * у снимка, пока не подтверждена. После ответа узла (`pull`) копия снова равна состоянию узла.
 */
export function applyOpLocally(entities: ReplicaEntityMap, op: SyncOp, ctx: OverlayContext): void {
  const docs: EntityDocs = (entities[op.entity] ??= {});
  const stampIso = new Date(Number(op.hlc.slice(0, 13))).toISOString();
  if (op.kind === "delete") {
    delete docs[op.entityId];
    if (op.entity === "list") {
      for (const [id, item] of Object.entries(entities.listItem)) {
        if ((item as { listId?: string }).listId === op.entityId) delete entities.listItem[id];
      }
    }
    return;
  }
  if (op.kind === "create") {
    if (docs[op.entityId]) return;
    docs[op.entityId] = defaultDoc(op, ctx, stampIso);
    return;
  }
  const doc = docs[op.entityId];
  if (!doc) return;
  Object.assign(doc, op.fields ?? {}, { updatedAt: stampIso });
  if (op.entity === "listItem" && op.fields && "checked" in op.fields) {
    const checked = op.fields.checked === true;
    doc.checkedAt = checked ? stampIso : null;
    doc.checkedById = checked ? ctx.userId : null;
    doc.checkedByName = checked ? ctx.userName : null;
  }
  if (op.entity === "note" && op.fields) doc.editedAt = stampIso;
  if (op.entity === "task" && op.fields && "status" in op.fields) doc.completedAt = op.fields.status === "done" ? stampIso : null;
}

function defaultDoc(op: SyncOp, ctx: OverlayContext, stampIso: string): Record<string, unknown> {
  const fields = op.fields ?? {};
  if (op.entity === "list") {
    return {
      id: op.entityId,
      workspaceId: ctx.workspaceId,
      name: "",
      kind: "general",
      isTemplate: false,
      sortOrder: 0,
      archivedAt: null,
      createdAt: stampIso,
      updatedAt: stampIso,
      ...fields
    };
  }
  if (op.entity === "listItem") {
    const checked = fields.checked === true;
    return {
      id: op.entityId,
      listId: op.parentId,
      label: "",
      checked: false,
      sortOrder: 0,
      inventoryItemId: null,
      quantity: 1,
      unit: null,
      note: "",
      dueAt: null,
      section: null,
      priceMinor: null,
      stocked: false,
      expenseTransactionId: null,
      checkedAt: checked ? stampIso : null,
      checkedById: checked ? ctx.userId : null,
      checkedByName: checked ? ctx.userName : null,
      createdAt: stampIso,
      updatedAt: stampIso,
      ...fields
    };
  }
  if (op.entity === "note") {
    return {
      id: op.entityId, workspaceId: ctx.workspaceId, projectId: null, title: "", number: null, summary: "", body: "", tags: [],
      pinnedAt: null, eventAt: null, editedAt: stampIso, deletedAt: null, archivedAt: null, dailyOn: null, isTemplate: false,
      revision: 1, createdAt: stampIso, updatedAt: stampIso, ...fields
    };
  }
  return {
    id: op.entityId, revision: 1, workspaceId: ctx.workspaceId, projectId: null, parentId: null, title: "", description: "",
    status: "todo", priority: "normal", dueAt: null, projectTag: null, recurrence: null, completedAt: null, sortOrder: 0,
    dependencyIds: [], blocked: false, assigneeId: null, startAt: null, estimatedMinutes: null, milestoneId: null,
    createdAt: stampIso, updatedAt: stampIso, ...fields
  };
}

/** Копия + очередь поверх неё. Исходный `state.entities` не меняется. */
export function overlayEntities(state: ReplicaState, userName: string | null = null): ReplicaEntityMap {
  const view = cloneEntities(state.entities);
  const ctx: OverlayContext = { userId: state.userId, workspaceId: state.workspaceId, userName };
  for (const pending of state.pending) applyOpLocally(view, pending.op, ctx);
  return view;
}

function compareByOrder(a: { sortOrder: number; createdAt: string; id: string }, b: { sortOrder: number; createdAt: string; id: string }): number {
  return a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Списки с вложенными пунктами в порядке показа: `(sortOrder, createdAt, id)` — одинаково на всех устройствах. */
export function assembleLists(entities: ReplicaEntityMap): List[] {
  const items = Object.values(entities.listItem) as unknown as ListItem[];
  const byList = new Map<string, ListItem[]>();
  for (const item of items) {
    const bucket = byList.get(item.listId) ?? [];
    bucket.push(item);
    byList.set(item.listId, bucket);
  }
  return (Object.values(entities.list) as unknown as Omit<List, "items">[])
    .sort(compareByOrder)
    .map((list) => ({ ...list, items: (byList.get(list.id) ?? []).sort(compareByOrder) }));
}

/** Состояние каждой сущности: конфликт > в очереди > только здесь > синхронизировано. */
export function entityStates(pending: readonly PendingOp[], conflicts: readonly ReplicaConflict[]): SyncStateMap {
  const states: SyncStateMap = new Map();
  const rank: Record<SyncState, number> = { synced: 0, local: 1, queued: 2, conflict: 3 };
  const put = (key: string, next: SyncState) => {
    const current = states.get(key);
    if (!current || rank[next] > rank[current]) states.set(key, next);
  };
  for (const entry of pending) put(`${entry.op.entity}:${entry.op.entityId}`, entry.state);
  for (const entry of conflicts) put(`${entry.op.entity}:${entry.op.entityId}`, "conflict");
  return states;
}

export function stateOf(states: SyncStateMap, entity: SyncEntityType, id: string): SyncState {
  return states.get(`${entity}:${id}`) ?? "synced";
}
