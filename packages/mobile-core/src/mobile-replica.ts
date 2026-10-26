import { z } from "zod";
import { HlcClock, normalizeOpFields, syncOpSchema, syncEntityTypeSchema, syncOutcomeSchema, syncReasonSchema, noteSchema, taskSchema, replicaListSchema, replicaListItemSchema } from "@orion/shared-types";
import type { ReplicaState } from "@orion/core";
import type { MobileSnapshot } from "./index";

export interface RemoteScope { nodeId: string; fingerprint: string; userId: string; workspaceId: string }
const document = z.record(z.unknown());
const replicaSchema = z.object({
  version: z.literal(1), userId: z.string(), workspaceId: z.string(),
  deviceId: z.string().uuid(), deviceName: z.string(), deviceRegistered: z.boolean(),
  protocol: z.number().int(), cursor: z.string().nullable(), asOf: z.string().nullable(),
  included: z.array(syncEntityTypeSchema),
  entities: z.object({ list: z.record(replicaListSchema), listItem: z.record(replicaListItemSchema), note: z.record(noteSchema), task: z.record(taskSchema) }),
  pending: z.array(z.object({ op: syncOpSchema, state: z.enum(["local", "queued"]), attempts: z.number().int().nonnegative(), createdAtMs: z.number() })),
  conflicts: z.array(z.object({ opId: z.string(), op: syncOpSchema, outcome: syncOutcomeSchema, reason: syncReasonSchema.optional(), lost: document.optional(), atMs: z.number() })),
  clock: z.object({ wallMs: z.number().int().nonnegative(), counter: z.number().int().nonnegative() }),
  deviceSeq: z.number().int().nonnegative(),
});
// Display metadata (for example workspaceName) is not part of replica identity.
const SCOPE_KEYS = ["nodeId", "fingerprint", "userId", "workspaceId"] as const;
const scopeSchema = z.object({ nodeId: z.string(), fingerprint: z.string(), userId: z.string(), workspaceId: z.string() });
export interface MobileReplicaEnvelope { version: 1; scope: RemoteScope; replica: ReplicaState; imported: Record<string, true> }
export function parseMobileReplica(raw: string, scope: RemoteScope): MobileReplicaEnvelope {
  const parsed = z.object({ version: z.literal(1), scope: scopeSchema, replica: replicaSchema, imported: z.record(z.literal(true)) }).parse(JSON.parse(raw));
  if (SCOPE_KEYS.some((key) => parsed.scope[key] !== scope[key])
    || parsed.replica.userId !== scope.userId || parsed.replica.workspaceId !== scope.workspaceId) throw new Error("Копия принадлежит другому пространству");
  if ([...Object.values(parsed.replica.entities.note), ...Object.values(parsed.replica.entities.task)].some((doc) => doc.workspaceId !== scope.workspaceId))
    throw new Error("В копии обнаружены записи другого пространства");
  if (Object.entries(parsed.replica.entities.list).some(([id, list]) => id !== list.id || list.workspaceId !== scope.workspaceId)
    || Object.entries(parsed.replica.entities.listItem).some(([id, item]) => id !== item.id || !parsed.replica.entities.list[item.listId])) throw new Error("В копии обнаружены списки другой области");
  return parsed as MobileReplicaEnvelope;
}
async function digest(value: unknown): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
}
export async function remoteScopeKey(scope: RemoteScope): Promise<string> {
  return Array.from(await digest([scope.nodeId, scope.fingerprint, scope.userId, scope.workspaceId]), (n) => n.toString(16).padStart(2, "0")).join("");
}
async function importId(scope: RemoteScope, entity: string, id: string): Promise<string> {
  const bytes = (await digest([scope.nodeId, scope.fingerprint, scope.userId, scope.workspaceId, entity, id])).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
/** Pure batch preparation: caller atomically commits envelope before opening the engine again.
 * The ledger survives server-side deletion, and prevents accidental re-publication. */
export async function prepareLocalImport(envelope: MobileReplicaEnvelope, source: MobileSnapshot, scope: RemoteScope) {
  if (source.lastBackupSeq !== source.deviceSeq) throw new Error("Сначала сохраните актуальную резервную копию записей телефона");
  const next = structuredClone(envelope);
  const state = next.replica;
  if (state.userId !== scope.userId || state.workspaceId !== scope.workspaceId
    || SCOPE_KEYS.some((key) => next.scope[key] !== scope[key])) throw new Error("Неверное пространство для переноса");
  const clock = new HlcClock(state.deviceId, Date.now, state.clock);
  let count = 0;
  const inputs = [
    ...source.tasks.map((task) => ({ entity: "task" as const, id: task.id, fields: {
      title: task.title, description: task.description, status: task.status, priority: task.priority,
      dueAt: task.dueAt, startAt: task.startAt, estimatedMinutes: task.estimatedMinutes, sortOrder: task.sortOrder,
    } })),
    ...source.notes.map((note) => {
      if (note.isPrivate) throw new Error("Личные заметки нельзя опубликовать этим способом");
      return { entity: "note" as const, id: note.id, fields: {
        title: note.title, summary: note.summary, body: note.body, tags: note.tags,
        pinnedAt: note.pinnedAt, archivedAt: note.archivedAt, eventAt: note.eventAt,
      } };
    }),
  ];
  for (const input of inputs) {
    const targetId = await importId(scope, input.entity, input.id);
    if (next.imported[targetId]) continue;
    if (!state.included.includes(input.entity)) throw new Error("Нужный модуль выключен в пространстве ПК");
    const op = syncOpSchema.parse({
      opId: crypto.randomUUID(), deviceId: state.deviceId, deviceSeq: ++state.deviceSeq,
      hlc: clock.now(), entity: input.entity, entityId: targetId, kind: "create",
      fields: normalizeOpFields(input.entity, input.fields),
    });
    state.pending.push({ op, state: "local", attempts: 0, createdAtMs: Date.now() });
    next.imported[targetId] = true;
    count++;
  }
  state.clock = clock.state();
  return { envelope: next, count };
}
