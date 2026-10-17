import type {
  List,
  PushSyncOpsInput,
  PushSyncOpsResult,
  RegisterSyncDeviceInput,
  ReplicaPull,
  ReplicaSnapshot,
  SyncEntityType,
  SyncOp,
  SyncOpResult,
  SyncOutcome,
  SyncReason,
  SyncState
} from "@orion/shared-types";

/** ТЗ-06 / ADR-0016 §7: локальная копия пространства — документы по сущностям + очередь операций. */
export type EntityDocs = Record<string, Record<string, unknown>>;
export type ReplicaEntityMap = Record<SyncEntityType, EntityDocs>;

/** Операция в очереди: `local` — ещё не отправлялась, `queued` — отправка начиналась и ждёт подтверждения. */
export interface PendingOp {
  op: SyncOp;
  state: "local" | "queued";
  attempts: number;
  createdAtMs: number;
}

/** Исход, которого человек должен коснуться: проигранные поля или отклонённая/конфликтная операция. */
export interface ReplicaConflict {
  opId: string;
  op: SyncOp;
  outcome: SyncOutcome;
  reason?: SyncReason;
  /** Поля, чьи значения проиграли: имя → значение, оставшееся на узле. */
  lost?: Record<string, unknown>;
  atMs: number;
}

export interface ReplicaState {
  version: 1;
  userId: string;
  workspaceId: string;
  deviceId: string;
  deviceName: string;
  deviceRegistered: boolean;
  protocol: number;
  cursor: string | null;
  /** Время на узле, к которому относятся данные (метка «данные на …»). */
  asOf: string | null;
  included: SyncEntityType[];
  entities: ReplicaEntityMap;
  pending: PendingOp[];
  conflicts: ReplicaConflict[];
  clock: { wallMs: number; counter: number };
  deviceSeq: number;
}

export interface ReplicaStorage {
  load(userId: string, workspaceId: string): Promise<ReplicaState | null>;
  save(state: ReplicaState): Promise<void>;
  clear(userId: string, workspaceId: string): Promise<void>;
}

export class MemoryReplicaStorage implements ReplicaStorage {
  private readonly data = new Map<string, string>();
  async load(userId: string, workspaceId: string): Promise<ReplicaState | null> {
    const raw = this.data.get(`${userId}:${workspaceId}`);
    return raw ? (JSON.parse(raw) as ReplicaState) : null;
  }
  async save(state: ReplicaState): Promise<void> {
    this.data.set(`${state.userId}:${state.workspaceId}`, JSON.stringify(state));
  }
  async clear(userId: string, workspaceId: string): Promise<void> {
    this.data.delete(`${userId}:${workspaceId}`);
  }
  /** Для тестов «откат устройства из бэкапа»: сырой слепок и его возврат. */
  dump(): Map<string, string> {
    return new Map(this.data);
  }
  restore(dump: Map<string, string>): void {
    this.data.clear();
    for (const [key, value] of dump) this.data.set(key, value);
  }
}

export interface SyncTransport {
  registerDevice(input: RegisterSyncDeviceInput): Promise<void>;
  snapshot(workspaceId: string): Promise<ReplicaSnapshot>;
  pull(workspaceId: string, cursor: string): Promise<ReplicaPull>;
  push(workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult>;
}

/** Состояние, которое видит UI: сеть, копия, метка времени и счётчики очереди. */
export interface ReplicaStatus {
  hasCopy: boolean;
  /** `idle` — всё отправлено; `offline` — нет связи с узлом; `error` — узел ответил непонятно; `revoked` — копия удалена. */
  phase: "idle" | "syncing" | "offline" | "error" | "revoked" | "incompatible";
  asOf: string | null;
  pending: number;
  conflicts: number;
  message: string | null;
}

export type SyncStateMap = Map<string, SyncState>;

/** Копия, собранная для показа: списки с пунктами и состояния по сущностям. */
export interface ReplicaListsView {
  lists: List[];
  states: SyncStateMap;
}

export type { SyncOpResult };

/** Минимум `ApiClient`, который нужен транспорту синхронизации (тесты подставляют свой). */
export interface SyncApi {
  registerSyncDevice(input: RegisterSyncDeviceInput): Promise<unknown>;
  getReplicaSnapshot(workspaceId: string): Promise<ReplicaSnapshot>;
  getReplicaChanges(workspaceId: string, cursor: string): Promise<ReplicaPull>;
  pushSyncOps(workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult>;
}

export function apiSyncTransport(api: SyncApi): SyncTransport {
  return {
    registerDevice: async (input) => void (await api.registerSyncDevice(input)),
    snapshot: (workspaceId) => api.getReplicaSnapshot(workspaceId),
    pull: (workspaceId, cursor) => api.getReplicaChanges(workspaceId, cursor),
    push: (workspaceId, input) => api.pushSyncOps(workspaceId, input)
  };
}
