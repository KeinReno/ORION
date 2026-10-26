import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  LIST_ITEMS_MAX,
  SYNC_ENTITY_TYPES,
  SYNC_LOG_RETENTION_DAYS,
  SYNC_PROTOCOL_VERSION,
  SYNC_PULL_LIMIT,
  SYNC_WRITABLE_ENTITIES,
  canonicalOpBody,
  decideOp,
  formatHlc,
  listKindSchema,
  parseHlc,
  type CreateTaskInput,
  type MergeDecision,
  type MergeEntityState,
  type OrionModuleId,
  type PushSyncOpsInput,
  type PushSyncOpsResult,
  type RegisterSyncDeviceInput,
  type ReplicaChange,
  type ReplicaList,
  type ReplicaPull,
  type ReplicaSnapshot,
  type SyncDevice,
  type SyncEntityType,
  type SyncMode,
  type SyncModeState,
  type SyncOp,
  type SyncOpResult
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { NotesService, toNoteDto } from "../notes/notes.service";
import { TasksService, toTaskDto } from "../tasks/tasks.service";
import { toItemDto } from "../lists/lists.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Модуль, без доступа к которому сущность ни едет в копию, ни принимается. */
const ENTITY_MODULE: Record<SyncEntityType, OrionModuleId> = { list: "lists", listItem: "lists", note: "notes", task: "tasks" };
const ORDER_STEP = 10;
const TASK_INCLUDE = { dependsOn: { include: { dependsOn: { select: { status: true } } } } } satisfies Prisma.TaskInclude;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Cursor {
  /** xid8 в десятичной записи. */
  x: string;
  /** Последний id ленты в этой транзакции. */
  i: string;
  /** Когда выдан (мс) — для проверки срока хранения ленты. */
  t: number;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.x === "string" && /^\d+$/.test(parsed.x) && typeof parsed.i === "string" && /^\d+$/.test(parsed.i) && typeof parsed.t === "number") {
      return { x: parsed.x, i: parsed.i, t: parsed.t };
    }
  } catch {
    // ниже — единый ответ
  }
  throw new GoneException({ code: "resync_required", message: "Курсор не распознан — нужна полная загрузка" });
}

const coded = (code: string, message: string) => ({ code, message });
const serverHlc = (nowMs: number): string => formatHlc({ wallMs: nowMs, counter: 0, deviceId: "host" });

type Tx = Prisma.TransactionClient;

/**
 * ТЗ-06 / ADR-0016: авторитетный узел гибридной синхронизации. Прав клиенту не доверяет: каждая операция
 * проходит членство, режим `hybrid`, доступность модуля, зарегистрированное устройство и RLS.
 */
@Injectable()
export class HybridSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly notes: NotesService,
    private readonly tasks: TasksService
  ) {}

  // --- режим и устройства -------------------------------------------------------------------

  async getMode(userId: string, workspaceId: string): Promise<SyncModeState> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return { mode: await this.modeTx(tx, workspaceId), protocol: SYNC_PROTOCOL_VERSION };
    });
  }

  async setMode(userId: string, workspaceId: string, mode: SyncMode): Promise<SyncModeState> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner"]);
      await tx.workspace.update({ where: { id: workspaceId }, data: { syncMode: mode } });
      return { mode, protocol: SYNC_PROTOCOL_VERSION };
    });
  }

  async registerDevice(userId: string, input: RegisterSyncDeviceInput): Promise<SyncDevice> {
    return this.prisma.withUser(userId, async (tx) => {
      const existing = await tx.syncDevice.findUnique({ where: { id: input.deviceId } });
      if (existing) {
        if (existing.revokedAt) throw new ForbiddenException(coded("device_revoked", "Устройство отозвано"));
        const row = await tx.syncDevice.update({ where: { id: input.deviceId }, data: { name: input.name, lastSeenAt: new Date() } });
        return toDeviceDto(row);
      }
      // Чужой deviceId RLS скрывает от нас — коллизию поймает первичный ключ.
      const taken = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "sync_devices" WHERE "id" = ${input.deviceId}`;
      if (Number(taken[0]?.n ?? 0) > 0) throw new ConflictException(coded("device_unknown", "Идентификатор устройства занят"));
      const row = await tx.syncDevice.create({ data: { id: input.deviceId, userId, name: input.name, lastSeenAt: new Date() } });
      return toDeviceDto(row);
    });
  }

  async listDevices(userId: string): Promise<SyncDevice[]> {
    const rows = await this.prisma.withUser(userId, (tx) => tx.syncDevice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }));
    return rows.map(toDeviceDto);
  }

  /** Быстрый отзыв: устройство больше не принимается. Скачанное остаётся (ADR-0016 §5). */
  async revokeDevice(userId: string, deviceId: string): Promise<SyncDevice> {
    return this.prisma.withUser(userId, async (tx) => {
      const row = await tx.syncDevice.findUnique({ where: { id: deviceId } });
      if (!row || row.userId !== userId) throw new NotFoundException("Устройство не найдено");
      return toDeviceDto(await tx.syncDevice.update({ where: { id: deviceId }, data: { revokedAt: row.revokedAt ?? new Date() } }));
    });
  }

  // --- снимок и лента -----------------------------------------------------------------------

  async snapshot(userId: string, workspaceId: string, protocol: number): Promise<ReplicaSnapshot> {
    assertProtocol(protocol);
    // Один снимок БД на все чтения: курсор и данные согласованы между собой.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        await this.assertHybridTx(tx, workspaceId);
        const [{ x }] = await tx.$queryRaw<{ x: string }[]>`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS x`;
        const included = await this.includedTx(tx, userId, workspaceId);
        const entities: ReplicaSnapshot["entities"] = { list: [], listItem: [], note: [], task: [] };
        if (included.includes("list")) {
          const lists = await tx.list.findMany({ where: { workspaceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
          entities.list = lists.map(toListDoc);
          const items = await tx.listItem.findMany({ where: { workspaceId }, include: { checkedBy: { select: { name: true } } } });
          entities.listItem = items.map(toItemDto);
        }
        if (included.includes("note")) {
          const notes = await tx.note.findMany({ where: { workspaceId, deletedAt: null, isTemplate: false } });
          entities.note = notes.map(toNoteDto);
        }
        if (included.includes("task")) {
          const tasks = await tx.task.findMany({ where: { workspaceId }, include: TASK_INCLUDE });
          entities.task = tasks.map(toTaskDto);
        }
        const nowMs = Date.now();
        return {
          protocol: SYNC_PROTOCOL_VERSION,
          workspaceId,
          asOf: new Date(nowMs).toISOString(),
          // Всё, что зафиксировано до xmin, уже в данных; строки с xid >= xmin доставятся повторно (идемпотентно).
          cursor: encodeCursor({ x, i: "0", t: nowMs }),
          serverHlc: await this.observedHlcTx(tx, workspaceId, included, nowMs),
          included,
          entities
        };
      },
      { isolationLevel: "RepeatableRead" }
    );
  }

  async pull(userId: string, workspaceId: string, cursorToken: string, protocol: number): Promise<ReplicaPull> {
    assertProtocol(protocol);
    const nowMs = Date.now();
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHybridTx(tx, workspaceId);
      // Доступ — раньше разбора курсора: постороннему не нужно знать, как выглядит «плохой» курсор.
      const cursor = decodeCursor(cursorToken);
      if (nowMs - cursor.t > SYNC_LOG_RETENTION_DAYS * DAY_MS) {
        throw new GoneException({ code: "resync_required", message: "Копия устарела — нужна полная загрузка" });
      }
      const included = await this.includedTx(tx, userId, workspaceId);
      // Только записи завершённых транзакций (xid < xmin): поздняя фиксация не может «проскочить» мимо курсора.
      const rows = await tx.$queryRaw<{ id: string; xid: string; entityType: string; entityId: string; parentId: string | null }[]>`
        SELECT "id"::text AS id, "xid"::text AS xid, "entityType", "entityId", "parentId"
        FROM "sync_changes"
        WHERE "workspaceId" = ${workspaceId}
          AND ("xid", "id") > (${cursor.x}::text::xid8, ${cursor.i}::text::bigint)
          AND "xid" < pg_snapshot_xmin(pg_current_snapshot())
        ORDER BY "xid", "id"
        LIMIT ${SYNC_PULL_LIMIT + 1}`;
      const hasMore = rows.length > SYNC_PULL_LIMIT;
      const page = hasMore ? rows.slice(0, SYNC_PULL_LIMIT) : rows;
      const last = page[page.length - 1];
      const latest = new Map<string, { entity: SyncEntityType; id: string; parentId: string | null }>();
      for (const row of page) {
        if (!isEntityType(row.entityType) || !included.includes(row.entityType)) continue;
        latest.set(`${row.entityType}:${row.entityId}`, { entity: row.entityType, id: row.entityId, parentId: row.parentId });
      }
      const changes = await this.resolveChangesTx(tx, workspaceId, [...latest.values()]);
      return {
        protocol: SYNC_PROTOCOL_VERSION,
        asOf: new Date(nowMs).toISOString(),
        cursor: last ? encodeCursor({ x: last.xid, i: last.id, t: nowMs }) : encodeCursor({ ...cursor, t: nowMs }),
        serverHlc: await this.observedHlcTx(tx, workspaceId, included, nowMs),
        hasMore,
        changes
      };
    });
  }

  /** Return a causal watermark, including accepted device clocks ahead of physical host time.
   * Otherwise a client can read a field and immediately lose its next edit as "older".
   * Keep the query in the caller's RLS transaction and limit it to included modules.
   */
  private async observedHlcTx(tx: Tx, workspaceId: string, included: SyncEntityType[], nowMs: number): Promise<string> {
    const physical = serverHlc(nowMs);
    if (!included.length) return physical;
    const [row] = await tx.$queryRaw<Array<{ hlc: string | null }>>`
      SELECT max(field.value COLLATE "C") AS hlc
      FROM "sync_entity_stamps" AS stamp
      CROSS JOIN LATERAL jsonb_each_text(stamp."stamps") AS field(key, value)
      WHERE stamp."workspaceId" = ${workspaceId}
        AND stamp."entityType" IN (${Prisma.join(included)})`;
    return row?.hlc && parseHlc(row.hlc) && row.hlc > physical ? row.hlc : physical;
  }

  /** Текущее состояние тронутых сущностей; нет строки (или она не для копии) — `doc: null`. */
  private async resolveChangesTx(
    tx: Tx,
    workspaceId: string,
    touched: Array<{ entity: SyncEntityType; id: string; parentId: string | null }>
  ): Promise<ReplicaChange[]> {
    const ids = (entity: SyncEntityType) => touched.filter((t) => t.entity === entity).map((t) => t.id);
    const docs = new Map<string, Record<string, unknown>>();
    const lists = await tx.list.findMany({ where: { workspaceId, id: { in: ids("list") } } });
    for (const row of lists) docs.set(`list:${row.id}`, toListDoc(row));
    const items = await tx.listItem.findMany({ where: { workspaceId, id: { in: ids("listItem") } }, include: { checkedBy: { select: { name: true } } } });
    for (const row of items) docs.set(`listItem:${row.id}`, toItemDto(row));
    const notes = await tx.note.findMany({ where: { workspaceId, id: { in: ids("note") }, deletedAt: null, isTemplate: false } });
    for (const row of notes) docs.set(`note:${row.id}`, toNoteDto(row));
    const tasks = await tx.task.findMany({ where: { workspaceId, id: { in: ids("task") } }, include: TASK_INCLUDE });
    for (const row of tasks) docs.set(`task:${row.id}`, toTaskDto(row));
    return touched.map((t) => ({ entity: t.entity, id: t.id, parentId: t.parentId, doc: docs.get(`${t.entity}:${t.id}`) ?? null }));
  }

  // --- приём операций -----------------------------------------------------------------------

  async push(userId: string, workspaceId: string, input: PushSyncOpsInput): Promise<PushSyncOpsResult> {
    assertProtocol(input.protocol);
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertHybridTx(tx, workspaceId);
      const device = await tx.syncDevice.findUnique({ where: { id: input.deviceId } });
      if (!device || device.userId !== userId) throw new ConflictException(coded("device_unknown", "Устройство не зарегистрировано"));
      if (device.revokedAt) throw new ForbiddenException(coded("device_revoked", "Устройство отозвано"));
      await tx.syncDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    });
    const results: SyncOpResult[] = [];
    for (const op of input.ops) {
      if (op.deviceId !== input.deviceId) {
        results.push({ opId: op.opId, outcome: "rejected", reason: "invalid", message: "Операция другого устройства" });
        continue;
      }
      // Каждая операция — своя транзакция: сбой одной не откатывает уже принятые.
      results.push(await this.prisma.withUser(userId, (tx) => this.applyOpTx(tx, userId, workspaceId, op)));
    }
    return { protocol: SYNC_PROTOCOL_VERSION, results, serverHlc: serverHlc(Date.now()) };
  }

  private async applyOpTx(tx: Tx, userId: string, workspaceId: string, op: SyncOp): Promise<SyncOpResult> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sync_push:" + workspaceId}))`;
    // Записи этой транзакции — синхронизация: триггер ленты не должен обесценивать их собственные штампы.
    await tx.$executeRaw`SELECT set_config('app.sync_apply', 'on', true)`;
    const hash = createHash("sha256").update(canonicalOpBody(op)).digest("hex");

    const known = await tx.syncOp.findUnique({ where: { workspaceId_opId: { workspaceId, opId: op.opId } } });
    if (known) {
      if (known.payloadHash !== hash) return { opId: op.opId, outcome: "rejected", reason: "op_id_reuse" };
      return known.result as unknown as SyncOpResult;
    }
    const sameSeq = await tx.syncOp.findUnique({ where: { deviceId_deviceSeq: { deviceId: op.deviceId, deviceSeq: op.deviceSeq } } });
    if (sameSeq) return { opId: op.opId, outcome: "rejected", reason: "device_rolled_back" };

    const record = async (result: SyncOpResult): Promise<SyncOpResult> => {
      await tx.syncOp.create({
        data: { workspaceId, opId: op.opId, deviceId: op.deviceId, deviceSeq: op.deviceSeq, payloadHash: hash, outcome: result.outcome, result: result as unknown as Prisma.InputJsonValue }
      });
      return result;
    };

    if (!SYNC_WRITABLE_ENTITIES.has(op.entity)) return record({ opId: op.opId, outcome: "rejected", reason: "not_writable" });
    const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    if (!accessible.has(ENTITY_MODULE[op.entity])) return record({ opId: op.opId, outcome: "rejected", reason: "not_writable", message: "Модуль выключен или недоступен" });

    const loaded = await this.loadStateTx(tx, workspaceId, op);
    if (loaded === "foreign") return record({ opId: op.opId, outcome: "rejected", reason: "invalid" });
    const decision = decideOp(op, loaded.state, loaded.parent, Date.now());
    const result: SyncOpResult = {
      opId: op.opId,
      outcome: decision.outcome,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.lost ? { lost: decision.lost } : {})
    };
    const failure = await this.persistDecisionTx(tx, userId, workspaceId, op, decision);
    if (failure) return record({ opId: op.opId, outcome: "rejected", reason: "invalid", message: failure });
    return record(result);
  }

  private async loadStateTx(
    tx: Tx,
    workspaceId: string,
    op: SyncOp
  ): Promise<"foreign" | { state: MergeEntityState; parent: { exists: boolean; deleted: boolean } | null }> {
    const stampRow = await tx.syncEntityStamp.findUnique({ where: { entityType_entityId: { entityType: op.entity, entityId: op.entityId } } });
    const stamps = (stampRow && stampRow.workspaceId === workspaceId ? stampRow.stamps : {}) as Record<string, string>;
    let exists = false;
    let trashed = false;
    let updatedAtMs = 0;
    let revision: number | undefined;
    let fields: Record<string, unknown> = {};
    if (op.entity === "note") {
      await tx.$queryRaw`SELECT "id" FROM "notes" WHERE "id" = ${op.entityId} FOR UPDATE`;
      const row = await tx.note.findUnique({ where: { id: op.entityId } });
      if (row && row.workspaceId !== workspaceId) return "foreign";
      if (row) {
        trashed = row.deletedAt !== null;
        exists = !trashed;
        updatedAtMs = row.updatedAt.getTime();
        revision = row.revision;
        fields = {
          title: row.title, summary: row.summary, body: row.body, tags: row.tags,
          pinnedAt: row.pinnedAt?.toISOString() ?? null, archivedAt: row.archivedAt?.toISOString() ?? null, eventAt: row.eventAt?.toISOString() ?? null
        };
      }
    } else if (op.entity === "task") {
      await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${op.entityId} FOR UPDATE`;
      const row = await tx.task.findUnique({ where: { id: op.entityId } });
      if (row && row.workspaceId !== workspaceId) return "foreign";
      if (row) {
        exists = true;
        updatedAtMs = row.updatedAt.getTime();
        revision = row.revision;
        fields = {
          title: row.title, description: row.description, status: row.status, priority: row.priority, parentId: row.parentId,
          dueAt: row.dueAt?.toISOString() ?? null, startAt: row.startAt?.toISOString() ?? null,
          estimatedMinutes: row.estimatedMinutes, sortOrder: row.sortOrder
        };
      }
    } else if (op.entity === "list") {
      await tx.$queryRaw`SELECT "id" FROM "lists" WHERE "id" = ${op.entityId} FOR UPDATE`;
      const row = await tx.list.findUnique({ where: { id: op.entityId } });
      if (row && row.workspaceId !== workspaceId) return "foreign";
      if (row) {
        exists = true;
        updatedAtMs = row.updatedAt.getTime();
        fields = { name: row.name, kind: row.kind, archivedAt: row.archivedAt?.toISOString() ?? null, sortOrder: row.sortOrder };
      }
    } else {
      await tx.$queryRaw`SELECT "id" FROM "list_items" WHERE "id" = ${op.entityId} FOR UPDATE`;
      const row = await tx.listItem.findUnique({ where: { id: op.entityId } });
      if (row && (row.workspaceId !== workspaceId || row.listId !== op.parentId)) return "foreign";
      if (row) {
        exists = true;
        updatedAtMs = row.updatedAt.getTime();
        fields = {
          label: row.label, checked: row.checked, quantity: row.quantity, unit: row.unit, note: row.note,
          dueAt: row.dueAt?.toISOString() ?? null, section: row.section, priceMinor: row.priceMinor, sortOrder: row.sortOrder
        };
      }
    }
    const deleted = !exists && (trashed || (await this.wasDeletedTx(tx, workspaceId, op.entity, op.entityId)));
    let parent: { exists: boolean; deleted: boolean } | null = null;
    if (op.entity === "listItem" && op.parentId) {
      const list = await tx.list.findUnique({ where: { id: op.parentId }, select: { workspaceId: true } });
      if (list && list.workspaceId !== workspaceId) return "foreign";
      parent = { exists: Boolean(list), deleted: !list && (await this.wasDeletedTx(tx, workspaceId, "list", op.parentId)) };
    }
    const taskParentId = op.entity === "task" && typeof op.fields?.parentId === "string" ? op.fields.parentId : null;
    if (taskParentId) {
      const task = await tx.task.findUnique({ where: { id: taskParentId }, select: { workspaceId: true } });
      if (task && task.workspaceId !== workspaceId) return "foreign";
      parent = { exists: Boolean(task), deleted: !task && (await this.wasDeletedTx(tx, workspaceId, "task", taskParentId)) };
    }
    return { state: { exists, deleted, stamps, updatedAtMs, fields, ...(revision !== undefined ? { revision } : {}) }, parent };
  }

  private async wasDeletedTx(tx: Tx, workspaceId: string, entity: SyncEntityType, id: string): Promise<boolean> {
    const hit = await tx.syncChange.findFirst({ where: { workspaceId, entityType: entity, entityId: id, kind: "delete" }, select: { id: true } });
    return Boolean(hit);
  }

  /** Возвращает текст причины, если запись невозможна (операция отклоняется, транзакция остаётся целой). */
  private async persistDecisionTx(tx: Tx, userId: string, workspaceId: string, op: SyncOp, decision: MergeDecision): Promise<string | null> {
    const wall = new Date(parseHlc(op.hlc)?.wallMs ?? Date.now());
    if (op.entity === "note" || op.entity === "task") return this.persistNoteTaskTx(tx, userId, workspaceId, op, decision);
    if (decision.create) {
      const fields = decision.create;
      if (op.entity === "list") {
        const last = await tx.list.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
        await tx.list.create({
          data: {
            id: op.entityId,
            workspaceId,
            name: fields.name as string,
            kind: listKindSchema.catch("general").parse(fields.kind ?? "general"),
            sortOrder: (fields.sortOrder as number | undefined) ?? (last._max.sortOrder ?? 0) + ORDER_STEP,
            archivedAt: fields.archivedAt ? new Date(fields.archivedAt as string) : null
          }
        });
      } else {
        const count = await tx.listItem.count({ where: { listId: op.parentId as string } });
        if (count >= LIST_ITEMS_MAX) return `В списке не может быть больше ${LIST_ITEMS_MAX} пунктов`;
        const last = await tx.listItem.aggregate({ where: { listId: op.parentId as string }, _max: { sortOrder: true } });
        await tx.listItem.create({
          data: {
            id: op.entityId,
            workspaceId,
            listId: op.parentId as string,
            label: fields.label as string,
            sortOrder: (fields.sortOrder as number | undefined) ?? (last._max.sortOrder ?? 0) + ORDER_STEP,
            quantity: (fields.quantity as number | undefined) ?? 1,
            unit: (fields.unit as string | null | undefined) ?? null,
            note: (fields.note as string | undefined) ?? "",
            dueAt: fields.dueAt ? new Date(fields.dueAt as string) : null,
            section: (fields.section as string | null | undefined) ?? null,
            priceMinor: (fields.priceMinor as number | null | undefined) ?? null,
            ...(fields.checked === true ? { checked: true, checkedAt: wall, checkedById: userId } : {})
          }
        });
      }
      await this.mergeStampsTx(tx, workspaceId, op, decision.stamps ?? {});
      return null;
    }
    if (decision.set && Object.keys(decision.set).length > 0) {
      const set = decision.set;
      if (op.entity === "list") {
        await tx.list.update({
          where: { id: op.entityId },
          data: {
            name: set.name as string | undefined,
            kind: set.kind === undefined ? undefined : listKindSchema.catch("general").parse(set.kind),
            sortOrder: set.sortOrder as number | undefined,
            archivedAt: set.archivedAt === undefined ? undefined : set.archivedAt === null ? null : new Date(set.archivedAt as string)
          }
        });
      } else {
        const current = await tx.listItem.findUniqueOrThrow({ where: { id: op.entityId }, select: { checked: true } });
        const ticking = set.checked === true && !current.checked;
        const unticking = set.checked === false && current.checked;
        await tx.listItem.update({
          where: { id: op.entityId },
          data: {
            label: set.label as string | undefined,
            checked: set.checked as boolean | undefined,
            quantity: set.quantity as number | undefined,
            unit: set.unit as string | null | undefined,
            note: set.note as string | undefined,
            dueAt: set.dueAt === undefined ? undefined : set.dueAt === null ? null : new Date(set.dueAt as string),
            section: set.section as string | null | undefined,
            priceMinor: set.priceMinor as number | null | undefined,
            sortOrder: set.sortOrder as number | undefined,
            ...(ticking ? { checkedAt: wall, checkedById: userId } : {}),
            ...(unticking ? { checkedAt: null, checkedById: null } : {})
          }
        });
      }
      await this.mergeStampsTx(tx, workspaceId, op, decision.stamps ?? {});
      return null;
    }
    if (decision.remove) {
      if (op.entity === "list") {
        const list = await tx.list.findUniqueOrThrow({ where: { id: op.entityId } });
        // То же правило, что у REST (`ListsService.deletePermanently`): сначала архив.
        if (!list.archivedAt && !list.isTemplate) return "Сначала уберите список в архив — удалить можно только архивный список или шаблон";
        await tx.list.delete({ where: { id: op.entityId } });
      } else {
        await tx.listItem.delete({ where: { id: op.entityId } });
      }
      await tx.syncEntityStamp.deleteMany({ where: { entityType: op.entity, entityId: op.entityId } });
    }
    return null;
  }

  /** Заметки и задачи пишутся через их же службы (`updateTx`/`createTx`): ссылки, журнал, повторы, таймеры — как у REST. */
  private async persistNoteTaskTx(tx: Tx, userId: string, workspaceId: string, op: SyncOp, decision: MergeDecision): Promise<string | null> {
    if (decision.create) {
      const f = decision.create;
      if (op.entity === "note") {
        await this.notes.createTx(
          tx,
          userId,
          workspaceId,
          {
            title: f.title as string,
            summary: f.summary as string | undefined,
            body: (f.body as string | undefined) ?? "",
            tags: (f.tags as string[] | undefined) ?? [],
            eventAt: (f.eventAt as string | null | undefined) ?? null
          },
          undefined,
          op.entityId
        );
        if (f.pinnedAt !== undefined || f.archivedAt !== undefined) {
          await this.notes.updateTx(tx, workspaceId, op.entityId, defineds({ pinnedAt: f.pinnedAt, archivedAt: f.archivedAt }));
        }
      } else {
        await this.tasks.createTx(
          tx,
          userId,
          workspaceId,
          {
            title: f.title as string,
            description: (f.description as string | undefined) ?? "",
            priority: (f.priority as "low" | "normal" | "high" | undefined) ?? "normal",
            parentId: (f.parentId as string | null | undefined) ?? null,
            dueAt: (f.dueAt as string | null | undefined) ?? null,
            startAt: (f.startAt as string | null | undefined) ?? null,
            estimatedMinutes: (f.estimatedMinutes as number | null | undefined) ?? null,
            checklist: Array.isArray(f.checklist) ? (f.checklist as CreateTaskInput["checklist"]) : []
          },
          op.entityId
        );
        const followUp = defineds({ status: f.status, sortOrder: f.sortOrder });
        if (Object.keys(followUp).length > 0) await this.tasks.updateTx(tx, userId, workspaceId, op.entityId, followUp);
      }
      await this.mergeStampsTx(tx, workspaceId, op, decision.stamps ?? {});
      return null;
    }
    if (decision.set && Object.keys(decision.set).length > 0) {
      if (op.entity === "note") {
        // Ревизию уже сверил `decideOp` под блокировкой строки; сюда она попадает как страховка CAS самой службы.
        await this.notes.updateTx(tx, workspaceId, op.entityId, { ...decision.set, ...(op.expectedRevision !== undefined ? { expectedRevision: op.expectedRevision } : {}) });
      } else {
        await this.tasks.updateTx(tx, userId, workspaceId, op.entityId, decision.set);
      }
      await this.mergeStampsTx(tx, workspaceId, op, decision.stamps ?? {});
      return null;
    }
    if (decision.remove) {
      if (op.entity === "note") await this.notes.removeTx(tx, workspaceId, op.entityId);
      else await tx.task.delete({ where: { id: op.entityId } });
      await tx.syncEntityStamp.deleteMany({ where: { entityType: op.entity, entityId: op.entityId } });
    }
    return null;
  }

  private async mergeStampsTx(tx: Tx, workspaceId: string, op: SyncOp, stamps: Record<string, string>): Promise<void> {
    const current = await tx.syncEntityStamp.findUnique({ where: { entityType_entityId: { entityType: op.entity, entityId: op.entityId } } });
    const merged = { ...((current?.stamps ?? {}) as Record<string, string>), ...stamps };
    await tx.syncEntityStamp.upsert({
      where: { entityType_entityId: { entityType: op.entity, entityId: op.entityId } },
      create: { entityType: op.entity, entityId: op.entityId, workspaceId, stamps: merged },
      update: { stamps: merged }
    });
  }

  // --- общее --------------------------------------------------------------------------------

  private async modeTx(tx: Tx, workspaceId: string): Promise<SyncMode> {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { syncMode: true } });
    const mode = workspace?.syncMode;
    return mode === "local" || mode === "hybrid" ? mode : "shared";
  }

  private async assertHybridTx(tx: Tx, workspaceId: string): Promise<void> {
    if ((await this.modeTx(tx, workspaceId)) !== "hybrid") {
      throw new ConflictException(coded("sync_mode_not_hybrid", "Пространство не в гибридном режиме"));
    }
  }

  private async includedTx(tx: Tx, userId: string, workspaceId: string): Promise<SyncEntityType[]> {
    const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
    return SYNC_ENTITY_TYPES.filter((entity) => accessible.has(ENTITY_MODULE[entity]));
  }

  /** Чистка по сроку хранения (ADR-0016 §2); вызывается кроном `SyncMaintenanceService`. */
  async purgeExpired(): Promise<{ changes: number; ops: number }> {
    const before = new Date(Date.now() - SYNC_LOG_RETENTION_DAYS * DAY_MS);
    return this.prisma.asSystem(async (tx) => {
      const changes = await tx.syncChange.deleteMany({ where: { at: { lt: before } } });
      const ops = await tx.syncOp.deleteMany({ where: { createdAt: { lt: before } } });
      return { changes: changes.count, ops: ops.count };
    });
  }
}

function defineds(fields: Record<string, unknown>): Record<string, never> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Record<string, never>;
}

function assertProtocol(protocol: number): void {
  if (protocol !== SYNC_PROTOCOL_VERSION) {
    throw new HttpException({ code: "protocol_unsupported", message: "Версия протокола не поддерживается", supported: [SYNC_PROTOCOL_VERSION] }, 426);
  }
}

function isEntityType(value: string): value is SyncEntityType {
  return (SYNC_ENTITY_TYPES as readonly string[]).includes(value);
}

function toDeviceDto(row: { id: string; name: string; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null }): SyncDevice {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null
  };
}

function toListDoc(row: { id: string; workspaceId: string; name: string; kind: string; isTemplate: boolean; sortOrder: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date }): ReplicaList {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: listKindSchema.catch("general").parse(row.kind),
    isTemplate: row.isTemplate,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
