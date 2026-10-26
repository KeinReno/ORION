import {
  HlcClock,
  SYNC_PROTOCOL_VERSION,
  SYNC_PUSH_MAX_OPS,
  SYNC_WRITABLE_ENTITIES,
  isAckedOutcome,
  noteSchema,
  replicaListItemSchema,
  replicaListSchema,
  taskSchema,
  validateOpFields,
  type List,
  type Note,
  type Task,
  type PushSyncOpsResult,
  type ReplicaChange,
  type SyncEntityType,
  type SyncOp,
  type SyncOpKind,
  type SyncState
} from "@orion/shared-types";
import {
  assembleLists,
  emptyEntities,
  entityStates,
  overlayEntities,
  stateOf
} from "./replica-view";
import type {
  PendingOp,
  ReplicaConflict,
  ReplicaEntityMap,
  ReplicaListsView,
  ReplicaState,
  ReplicaStatus,
  ReplicaStorage,
  SyncTransport
} from "./replica-types";

export interface ReplicaEngineOptions {
  transport: SyncTransport;
  storage: ReplicaStorage;
  userId: string;
  workspaceId: string;
  deviceName?: string;
  userName?: string | null;
  now?: () => number;
  uuid?: () => string;
}

/** Ошибка записи, которую можно показать человеку как есть (офлайн-запись этой сущности недоступна и т. п.). */
export class ReplicaWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicaWriteError";
  }
}

export interface EnqueueInput {
  entity: SyncEntityType;
  entityId?: string;
  parentId?: string;
  kind: SyncOpKind;
  fields?: Record<string, unknown>;
  expectedRevision?: number;
}

export interface SyncReport {
  phase: ReplicaStatus["phase"];
  pushed: number;
  pulled: number;
}

type Listener = () => void;

interface ClassifiedError {
  kind: "network" | "revoked" | "resync" | "incompatible" | "rolled_back" | "device_unknown" | "other";
  message: string;
}

function classify(error: unknown): ClassifiedError {
  const e = error as { status?: unknown; details?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "Ошибка синхронизации";
  if (!e || typeof e.status !== "number") return { kind: "network", message };
  const code = (e.details as { code?: unknown } | undefined)?.code;
  if (e.status === 410 || code === "resync_required") return { kind: "resync", message };
  if (e.status === 426 || code === "protocol_unsupported") return { kind: "incompatible", message };
  if (code === "device_rolled_back") return { kind: "rolled_back", message };
  if (code === "device_unknown") return { kind: "device_unknown", message };
  if (e.status === 401 || e.status === 403 || e.status === 404 || code === "sync_mode_not_hybrid" || code === "device_revoked") {
    return { kind: "revoked", message };
  }
  if (e.status >= 500 || e.status === 408 || e.status === 429) return { kind: "network", message };
  return { kind: "other", message };
}

function removeTaskDescendants(tasks: ReplicaEntityMap["task"], parentId: string): void {
  const children = Object.entries(tasks).filter(([, task]) => (task as { parentId?: string | null }).parentId === parentId);
  for (const [id] of children) {
    delete tasks[id];
    removeTaskDescendants(tasks, id);
  }
}

/**
 * Клиентская сторона гибридной синхронизации (ADR-0016). Хранит копию пространства и очередь операций,
 * отправляет их на авторитетный узел и подтягивает ленту изменений.
 *
 * Инварианты:
 *  - операция попадает в очередь и на диск ДО попытки отправки; из очереди её убирает только ответ узла;
 *  - «синхронизировано» — это отсутствие операции в очереди после подтверждения узла, а не локальная запись;
 *  - запись в сущности вне `SYNC_WRITABLE_ENTITIES` отвергается сразу и с объяснением;
 *  - отзыв членства / выключение гибрида на узле стирает копию при следующем подключении.
 */
export class ReplicaEngine {
  private state: ReplicaState | null = null;
  private phase: ReplicaStatus["phase"] = "idle";
  private message: string | null = null;
  private clock: HlcClock | null = null;
  /** Очередь сетевых циклов (`sync`/`bootstrap`/`wipe`): они ждут ответов узла и могут быть долгими. */
  private tail: Promise<unknown> = Promise.resolve();
  /** Очередь локальных записей: ждёт только диск, поэтому правка без связи не стоит за зависшим запросом. */
  private writeTail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly uuid: () => string;
  private version = 0;

  constructor(private readonly options: ReplicaEngineOptions) {
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  }

  // --- жизненный цикл ---------------------------------------------------------------------

  /** Читает копию с диска. Возвращает `true`, если она есть. */
  async open(): Promise<boolean> {
    this.state = await this.options.storage.load(this.options.userId, this.options.workspaceId);
    if (this.state) this.clock = new HlcClock(this.state.deviceId, this.now, this.state.clock);
    this.emit();
    return this.state !== null;
  }

  hasCopy(): boolean {
    return this.state !== null;
  }

  /** Полностью стирает копию (отзыв доступа, выход из пространства). */
  async wipe(): Promise<void> {
    await this.serial(async () => {
      this.state = null;
      this.clock = null;
      await this.options.storage.clear(this.options.userId, this.options.workspaceId);
    });
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Растёт при каждом изменении копии/очереди/статуса — удобно для `useSyncExternalStore`. */
  snapshotVersion(): number {
    return this.version;
  }

  // --- чтение -----------------------------------------------------------------------------

  status(): ReplicaStatus {
    return {
      hasCopy: this.state !== null,
      phase: this.phase,
      asOf: this.state?.asOf ?? null,
      pending: this.state?.pending.length ?? 0,
      conflicts: this.state?.conflicts.length ?? 0,
      message: this.message
    };
  }

  /** Сущности копии с очередью поверх. */
  entities(): ReplicaEntityMap {
    return this.state ? overlayEntities(this.state, this.options.userName ?? null) : emptyEntities();
  }

  /** Заметки копии (без корзины) с очередью поверх, новые сверху по `editedAt`. */
  notes(): Note[] {
    return (Object.values(this.entities().note) as unknown as Note[]).filter((n) => !n.deletedAt);
  }

  tasks(): Task[] {
    return Object.values(this.entities().task) as unknown as Task[];
  }

  lists(): ReplicaListsView {
    const state = this.state;
    if (!state) return { lists: [], states: new Map() };
    const lists: List[] = assembleLists(overlayEntities(state, this.options.userName ?? null));
    return { lists, states: entityStates(state.pending, state.conflicts) };
  }

  syncStateOf(entity: SyncEntityType, id: string): SyncState {
    return this.state ? stateOf(entityStates(this.state.pending, this.state.conflicts), entity, id) : "synced";
  }

  conflicts(): readonly ReplicaConflict[] {
    return this.state?.conflicts ?? [];
  }

  pending(): readonly PendingOp[] {
    return this.state?.pending ?? [];
  }

  // --- запись -----------------------------------------------------------------------------

  /** Ставит операцию в очередь и пишет её на диск. Возвращает операцию (id создаваемой сущности — `op.entityId`). */
  async enqueue(input: EnqueueInput): Promise<SyncOp> {
    return this.serialWrite(async () => {
      const state = this.requireState();
      if (!SYNC_WRITABLE_ENTITIES.has(input.entity)) {
        throw new ReplicaWriteError("Эту запись нельзя сохранить без связи с узлом: офлайн-запись для неё не включена.");
      }
      const problem = validateOpFields(input.entity, input.kind, input.fields);
      if (problem) throw new ReplicaWriteError(problem);
      const entityId = input.entityId ?? this.uuid();
      if (input.entity === "listItem" && !input.parentId) throw new ReplicaWriteError("Пункту нужен список");

      // Заметка: правка идёт только через CAS. Ревизия основы — из копии (или 1 для созданной офлайн),
      // плюс столько правок этой заметки, сколько уже стоит впереди в очереди: каждая применённая даёт +1.
      const expectedRevision =
        input.expectedRevision ?? (input.entity === "note" && input.kind === "patch" ? this.noteBaseRevision(state, entityId) : undefined);
      if (input.entity === "note" && input.kind === "patch" && expectedRevision === undefined) {
        throw new ReplicaWriteError("Этой заметки нет в локальной копии — править её без связи нельзя.");
      }

      state.deviceSeq += 1;
      const clock = this.requireClock();
      const op: SyncOp = {
        opId: this.uuid(),
        deviceId: state.deviceId,
        deviceSeq: state.deviceSeq,
        hlc: clock.now(),
        entity: input.entity,
        entityId,
        kind: input.kind,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.fields ? { fields: input.fields } : {}),
        ...(expectedRevision !== undefined ? { expectedRevision } : {})
      };
      state.pending.push({ op, state: "local", attempts: 0, createdAtMs: this.now() });
      await this.persist();
      return op;
    });
  }

  /** Снимает конфликт: операция отбрасывается (версия узла остаётся). */
  async dismissConflict(opId: string): Promise<void> {
    await this.serialWrite(async () => {
      const state = this.requireState();
      state.conflicts = state.conflicts.filter((entry) => entry.opId !== opId);
      await this.persist();
    });
  }

  /** «Сохранить мою поверх»: переотправляет операцию из конфликта новой операцией (свежий HLC, `expectedRevision` при необходимости). */
  async retryConflict(opId: string, expectedRevision?: number): Promise<SyncOp | null> {
    return this.serialWrite(async () => {
      const state = this.requireState();
      const entry = state.conflicts.find((c) => c.opId === opId);
      if (!entry) return null;
      state.conflicts = state.conflicts.filter((c) => c.opId !== opId);
      state.deviceSeq += 1;
      // «Сохранить мою поверх»: для заметки — против ревизии узла, какой её видит копия сейчас.
      const revision = expectedRevision ?? (entry.op.entity === "note" ? this.noteBaseRevision(state, entry.op.entityId) : undefined);
      const op: SyncOp = {
        ...entry.op,
        opId: this.uuid(),
        deviceSeq: state.deviceSeq,
        hlc: this.requireClock().now(),
        ...(revision !== undefined ? { expectedRevision: revision } : {})
      };
      state.pending.push({ op, state: "local", attempts: 0, createdAtMs: this.now() });
      await this.persist();
      return op;
    });
  }

  private noteBaseRevision(state: ReplicaState, noteId: string): number | undefined {
    const canonical = state.entities.note[noteId] as { revision?: unknown } | undefined;
    const createdOffline = state.pending.some((p) => p.op.entity === "note" && p.op.entityId === noteId && p.op.kind === "create");
    const base = typeof canonical?.revision === "number" ? canonical.revision : createdOffline ? 1 : undefined;
    if (base === undefined) return undefined;
    const ahead = state.pending.filter((p) => p.op.entity === "note" && p.op.entityId === noteId && p.op.kind === "patch").length;
    return base + ahead;
  }

  // --- синхронизация ----------------------------------------------------------------------

  /** Отправка очереди, затем подтяжка ленты. Сеть недоступна — не ошибка: копия и очередь остаются. */
  async sync(): Promise<SyncReport> {
    return this.serial(async () => {
      const report: SyncReport = { phase: "idle", pushed: 0, pulled: 0 };
      this.phase = "syncing";
      this.message = null;
      this.emit();
      const attempt = async (): Promise<void> => {
        if (!this.state) await this.bootstrapLocked();
        else await this.ensureDeviceLocked();
        report.pushed += await this.pushLocked();
        report.pulled += await this.pullLocked();
        this.phase = "idle";
      };
      try {
        try {
          await attempt();
        } catch (error) {
          // Перезагрузка снимка / смена личности устройства чинят причину — один повтор с новой копией.
          const kind = classify(error).kind;
          await this.handleFailure(error);
          if ((kind === "resync" || kind === "rolled_back" || kind === "device_unknown") && (this.phase as ReplicaStatus["phase"]) === "idle" && this.state) {
            await attempt();
          }
        }
      } catch (error) {
        await this.handleFailure(error);
      }
      report.phase = this.phase;
      this.emit();
      return report;
    });
  }

  /** Загрузить снимок заново (первое открытие, `resync_required`). Очередь сохраняется. */
  async bootstrap(): Promise<void> {
    await this.serial(async () => {
      this.phase = "syncing";
      this.emit();
      try {
        await this.bootstrapLocked();
        this.phase = "idle";
      } catch (error) {
        await this.handleFailure(error);
      }
      this.emit();
    });
  }

  // --- внутреннее -------------------------------------------------------------------------

  private async bootstrapLocked(): Promise<void> {
    const previous = this.state;
    const deviceId = previous?.deviceId ?? this.uuid();
    const deviceName = previous?.deviceName ?? this.options.deviceName ?? "Это устройство";
    // Устройство регистрируется до первого снимка: узел отвечает на push только известным устройствам.
    await this.options.transport.registerDevice({ deviceId, name: deviceName });
    const snapshot = await this.options.transport.snapshot(this.options.workspaceId);
    this.assertProtocol(snapshot.protocol);
    const entities = emptyEntities();
    for (const entity of snapshot.included) {
      for (const doc of snapshot.entities[entity] as Array<{ id: string }>) {
        const validated = this.validateDoc(entity, doc);
        if (validated) entities[entity][doc.id] = validated;
      }
    }
    const clock = new HlcClock(deviceId, this.now, previous?.clock);
    clock.receive(snapshot.serverHlc);
    this.clock = clock;
    this.state = {
      version: 1,
      userId: this.options.userId,
      workspaceId: this.options.workspaceId,
      deviceId,
      deviceName,
      deviceRegistered: true,
      protocol: snapshot.protocol,
      cursor: snapshot.cursor,
      asOf: snapshot.asOf,
      included: snapshot.included,
      entities,
      pending: previous?.pending ?? [],
      conflicts: previous?.conflicts ?? [],
      clock: clock.state(),
      deviceSeq: previous?.deviceSeq ?? 0
    };
    await this.persist();
  }

  private async ensureDeviceLocked(): Promise<void> {
    const state = this.requireState();
    if (state.deviceRegistered) return;
    await this.options.transport.registerDevice({ deviceId: state.deviceId, name: state.deviceName });
    state.deviceRegistered = true;
    await this.persist();
  }

  private async pushLocked(): Promise<number> {
    const state = this.requireState();
    let sent = 0;
    while (state.pending.length > 0) {
      const batch = state.pending.slice(0, SYNC_PUSH_MAX_OPS);
      for (const entry of batch) {
        entry.state = "queued";
        entry.attempts += 1;
      }
      await this.persist();
      const response = await this.options.transport.push(this.options.workspaceId, {
        protocol: SYNC_PROTOCOL_VERSION,
        deviceId: state.deviceId,
        ops: batch.map((entry) => entry.op)
      });
      this.assertProtocol(response.protocol);
      await this.applyPushResult(batch, response);
      sent += batch.length;
    }
    return sent;
  }

  private async applyPushResult(batch: PendingOp[], response: PushSyncOpsResult): Promise<void> {
    const state = this.requireState();
    this.requireClock().receive(response.serverHlc);
    if (response.results.some((result) => result.reason === "device_rolled_back")) {
      throw Object.assign(new Error("Устройство восстановлено из резервной копии"), { status: 409, details: { code: "device_rolled_back" } });
    }
    const byId = new Map(response.results.map((result) => [result.opId, result]));
    const done = new Set<string>();
    for (const entry of batch) {
      const result = byId.get(entry.op.opId);
      // Узел обязан ответить по каждой операции; молчание — не подтверждение, операция остаётся в очереди.
      if (!result) continue;
      done.add(entry.op.opId);
      const informative = result.outcome === "conflict" || result.outcome === "rejected" || result.outcome === "superseded" || result.outcome === "merged";
      if (informative) {
        state.conflicts.push({
          opId: entry.op.opId,
          op: entry.op,
          outcome: result.outcome,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.lost ? { lost: result.lost } : {}),
          atMs: this.now()
        });
      } else if (!isAckedOutcome(result.outcome)) {
        state.conflicts.push({ opId: entry.op.opId, op: entry.op, outcome: result.outcome, atMs: this.now() });
      }
    }
    state.pending = state.pending.filter((entry) => !done.has(entry.op.opId));
    state.clock = this.requireClock().state();
    await this.persist();
    if (done.size === 0) {
      // Узел принял запрос, но не подтвердил ни одной операции: повторять сразу бессмысленно.
      throw Object.assign(new Error("Узел не подтвердил операции"), { status: 502 });
    }
  }

  private async pullLocked(): Promise<number> {
    const state = this.requireState();
    let total = 0;
    for (let guard = 0; guard < 1000; guard += 1) {
      const response = await this.options.transport.pull(this.options.workspaceId, state.cursor ?? "");
      this.assertProtocol(response.protocol);
      for (const change of response.changes) this.applyChange(state, change);
      this.requireClock().receive(response.serverHlc);
      state.cursor = response.cursor;
      state.asOf = response.asOf;
      state.clock = this.requireClock().state();
      total += response.changes.length;
      await this.persist();
      if (!response.hasMore) break;
    }
    return total;
  }

  private applyChange(state: ReplicaState, change: ReplicaChange): void {
    if (!state.included.includes(change.entity)) return;
    const docs = (state.entities[change.entity] ??= {});
    if (change.doc === null) {
      delete docs[change.id];
      if (change.entity === "list") {
        for (const [id, item] of Object.entries(state.entities.listItem)) {
          if ((item as { listId?: string }).listId === change.id) delete state.entities.listItem[id];
        }
      }
      if (change.entity === "task") removeTaskDescendants(state.entities.task, change.id);
      return;
    }
    const validated = this.validateDoc(change.entity, { ...change.doc, id: change.id });
    if (validated) docs[change.id] = validated;
  }

  /** Ответ узла не доверенный: список и пункт проходят zod; неизвестное — отбрасывается, копия не портится. */
  private validateDoc(entity: SyncEntityType, doc: { id: string }): Record<string, unknown> | null {
    if (entity === "list") {
      const parsed = replicaListSchema.safeParse(doc);
      return parsed.success ? (parsed.data as Record<string, unknown>) : null;
    }
    if (entity === "listItem") {
      const parsed = replicaListItemSchema.safeParse(doc);
      return parsed.success ? (parsed.data as Record<string, unknown>) : null;
    }
    if (entity === "note") {
      const parsed = noteSchema.safeParse(doc);
      return parsed.success ? (parsed.data as Record<string, unknown>) : null;
    }
    const parsed = taskSchema.safeParse(doc);
    return parsed.success ? (parsed.data as Record<string, unknown>) : null;
  }

  private assertProtocol(protocol: number): void {
    if (protocol !== SYNC_PROTOCOL_VERSION) {
      throw Object.assign(new Error("Версия протокола узла не поддерживается"), { status: 426, details: { code: "protocol_unsupported" } });
    }
  }

  private async handleFailure(error: unknown): Promise<void> {
    const failure = classify(error);
    switch (failure.kind) {
      case "network":
        this.phase = "offline";
        this.message = "Нет связи с узлом — изменения сохранены на устройстве и отправятся позже.";
        return;
      case "revoked":
        // ADR-0016 §5: доступ отозван (или гибрид выключен) — копия удаляется. Уже скачанное не отзывается.
        this.state = null;
        this.clock = null;
        await this.options.storage.clear(this.options.userId, this.options.workspaceId);
        this.phase = "revoked";
        this.message = "Доступ к пространству закрыт — локальная копия удалена.";
        return;
      case "incompatible":
        this.phase = "incompatible";
        this.message = "Узел использует другую версию протокола. Обновите приложение.";
        return;
      case "resync":
        try {
          await this.bootstrapLocked();
          this.phase = "idle";
        } catch (inner) {
          await this.handleFailure(inner);
        }
        return;
      case "rolled_back":
      case "device_unknown":
        try {
          await this.rebaseOnNewDeviceLocked();
          this.phase = "idle";
        } catch (inner) {
          await this.handleFailure(inner);
        }
        return;
      default:
        this.phase = "error";
        this.message = failure.message;
    }
  }

  /**
   * Откат из бэкапа (или стёртая регистрация): прежняя личность устройства скомпрометирована счётчиком.
   * Берём новый `deviceId`, переоформляем неотправленные операции новыми id/HLC и грузим снимок заново.
   */
  private async rebaseOnNewDeviceLocked(): Promise<void> {
    const state = this.requireState();
    const deviceId = this.uuid();
    const clock = new HlcClock(deviceId, this.now);
    const pending = state.pending;
    this.clock = clock;
    state.deviceId = deviceId;
    state.deviceRegistered = false;
    state.deviceSeq = 0;
    state.pending = pending.map((entry) => {
      state.deviceSeq += 1;
      return {
        ...entry,
        state: "local" as const,
        attempts: 0,
        op: { ...entry.op, opId: this.uuid(), deviceId, deviceSeq: state.deviceSeq, hlc: clock.now() }
      };
    });
    state.clock = clock.state();
    await this.persist();
    await this.bootstrapLocked();
  }

  private requireState(): ReplicaState {
    if (!this.state) throw new ReplicaWriteError("Локальной копии пространства нет — подключитесь к узлу.");
    return this.state;
  }

  private requireClock(): HlcClock {
    if (!this.clock) throw new ReplicaWriteError("Локальной копии пространства нет — подключитесь к узлу.");
    return this.clock;
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    this.state.clock = this.clock?.state() ?? this.state.clock;
    await this.options.storage.save(this.state);
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private serialWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(task, task);
    this.writeTail = run.catch(() => undefined);
    return run;
  }

  /** Очередь вызовов: запись и синхронизация не перемешиваются, диск не получает конкурирующих сохранений. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
