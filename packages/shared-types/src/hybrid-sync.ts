import { z } from "zod";
import { listKindSchema, listItemSchema, listSchema } from "./list";
import { taskChecklistSchema, taskPrioritySchema, taskStatusSchema } from "./task";

/**
 * ТЗ-06 / ADR-0016 — контракт гибридной синхронизации. Не путать с `sync.ts` (резервные копии WebDAV).
 * Здесь: версия протокола, часы HLC, операции клиента, ответы узла и слепок локальной копии.
 */
export const SYNC_PROTOCOL_VERSION = 1;
/** Сколько дней узел хранит ленту изменений; курсор старше — `resync_required`. */
export const SYNC_LOG_RETENTION_DAYS = 90;
/** Операция с HLC дальше чем на столько в будущем отвергается (`hlc_in_future`). */
export const SYNC_MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
export const SYNC_PUSH_MAX_OPS = 100;
export const SYNC_PULL_LIMIT = 500;

export const SYNC_MODES = ["local", "shared", "hybrid"] as const;
export const syncModeSchema = z.enum(SYNC_MODES);
export type SyncMode = z.infer<typeof syncModeSchema>;
export const SYNC_MODE_LABELS: Record<SyncMode, string> = {
  local: "Только локально",
  shared: "Общий узел (запись онлайн)",
  hybrid: "Гибрид (копия на устройстве)"
};

/** Сущности, которые вообще могут ехать на устройство. Запись офлайн — подмножество, см. `SYNC_WRITABLE_ENTITIES`. */
export const SYNC_ENTITY_TYPES = ["list", "listItem", "note", "task"] as const;
export const syncEntityTypeSchema = z.enum(SYNC_ENTITY_TYPES);
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;

// ---------------------------------------------------------------------------------------------
// HLC — гибридные логические часы. Строка сравнивается лексикографически.
// ---------------------------------------------------------------------------------------------

const HLC_RE = /^(\d{13})\.(\d{5})\.([0-9a-zA-Z-]{1,64})$/;

export interface Hlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}

export function formatHlc(hlc: Hlc): string {
  return `${String(Math.max(0, Math.trunc(hlc.wallMs))).padStart(13, "0")}.${String(hlc.counter).padStart(5, "0")}.${hlc.deviceId}`;
}

export function parseHlc(value: string): Hlc | null {
  const match = HLC_RE.exec(value);
  if (!match) return null;
  return { wallMs: Number(match[1]), counter: Number(match[2]), deviceId: match[3] as string };
}

export const hlcSchema = z.string().regex(HLC_RE, "Некорректный HLC");

/** HLC «по времени записи строки»: штамп поля, которое писал не sync, а обычный REST. */
export function hlcFromMs(wallMs: number): string {
  return formatHlc({ wallMs, counter: 0, deviceId: "0" });
}

/**
 * Часы устройства. `now()` монотонно растёт даже при откате системных часов; `receive()` вливает
 * HLC, пришедший с узла, чтобы новые операции не получали штамп «из прошлого» относительно уже
 * виденных.
 */
export class HlcClock {
  private wallMs = 0;
  private counter = 0;

  constructor(
    private readonly deviceId: string,
    private readonly wall: () => number = Date.now,
    state?: { wallMs: number; counter: number }
  ) {
    if (state) {
      this.wallMs = state.wallMs;
      this.counter = state.counter;
    }
  }

  now(): string {
    const physical = this.wall();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return formatHlc({ wallMs: this.wallMs, counter: this.counter, deviceId: this.deviceId });
  }

  receive(remote: string): void {
    const parsed = parseHlc(remote);
    if (!parsed) return;
    const physical = this.wall();
    const newWall = Math.max(physical, this.wallMs, parsed.wallMs);
    let counter = 0;
    if (newWall === this.wallMs && newWall === parsed.wallMs) counter = Math.max(this.counter, parsed.counter);
    else if (newWall === this.wallMs) counter = this.counter;
    else if (newWall === parsed.wallMs) counter = parsed.counter;
    this.wallMs = newWall;
    this.counter = counter;
  }

  state(): { wallMs: number; counter: number } {
    return { wallMs: this.wallMs, counter: this.counter };
  }
}

// ---------------------------------------------------------------------------------------------
// Поля, которые клиент вправе менять (всё остальное — только узел)
// ---------------------------------------------------------------------------------------------

const nameField = z.string().trim().min(1).max(120);
const itemLabelField = z.string().trim().min(1).max(500);
const isoDate = z.string().datetime();

const LIST_FIELDS = {
  name: nameField,
  kind: listKindSchema,
  archivedAt: isoDate.nullable(),
  sortOrder: z.number().int().min(-1_000_000_000).max(1_000_000_000)
};
const LIST_ITEM_FIELDS = {
  label: itemLabelField,
  checked: z.boolean(),
  quantity: z.number().int().min(1).max(100_000),
  unit: z.string().trim().min(1).max(20).nullable(),
  note: z.string().max(2000),
  dueAt: isoDate.nullable(),
  section: z.string().trim().min(1).max(60).nullable(),
  priceMinor: z.number().int().min(0).max(2_000_000_000).nullable(),
  sortOrder: z.number().int().min(-1_000_000_000).max(1_000_000_000)
};

const NOTE_FIELDS = {
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(300),
  body: z.string().max(20_000),
  tags: z.array(z.string().min(1).max(40)).max(20),
  pinnedAt: isoDate.nullable(),
  archivedAt: isoDate.nullable(),
  eventAt: isoDate.nullable()
};
const TASK_FIELDS = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueAt: isoDate.nullable(),
  startAt: isoDate.nullable(),
  estimatedMinutes: z.number().int().min(0).max(10_000_000).nullable(),
  sortOrder: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  checklist: taskChecklistSchema
};

/** Поля, которые клиент вправе менять офлайн. Всё остальное (проект, исполнитель, повтор…) — только онлайн. */
const FIELD_SCHEMAS: Record<SyncEntityType, Record<string, z.ZodTypeAny>> = {
  list: LIST_FIELDS,
  listItem: LIST_ITEM_FIELDS,
  note: NOTE_FIELDS,
  task: TASK_FIELDS
};
/** Поля, без которых `create` недопустим. */
const REQUIRED_ON_CREATE: Record<SyncEntityType, string[]> = {
  list: ["name"],
  listItem: ["label"],
  note: ["title"],
  task: ["title"]
};

export function syncFieldNames(entity: SyncEntityType): string[] {
  return Object.keys(FIELD_SCHEMAS[entity]);
}

/** Сущности, в которые ПИШЕТ клиент офлайн в текущей версии протокола. Совпадает с этапом ТЗ-06. */
export const SYNC_WRITABLE_ENTITIES: ReadonlySet<SyncEntityType> = new Set<SyncEntityType>(["list", "listItem", "note", "task"]);

export type SyncOpKind = "create" | "patch" | "delete";

// ---------------------------------------------------------------------------------------------
// Операция
// ---------------------------------------------------------------------------------------------

export const syncOpSchema = z
  .object({
    opId: z.string().uuid(),
    deviceId: z.string().uuid(),
    /** Счётчик устройства: выдаётся один раз и навсегда; повтор с другим opId = откат устройства. */
    deviceSeq: z.number().int().min(1),
    hlc: hlcSchema,
    entity: syncEntityTypeSchema,
    entityId: z.string().uuid(),
    /** Для `listItem` — список; иначе не используется. */
    parentId: z.string().uuid().optional(),
    kind: z.enum(["create", "patch", "delete"]),
    fields: z.record(z.unknown()).optional(),
    /** Заметки (обязателен для `patch`) и задачи (по желанию): ревизия, которую видел автор. */
    expectedRevision: z.number().int().min(1).optional()
  })
  .superRefine((op, ctx) => {
    const deviceInHlc = parseHlc(op.hlc)?.deviceId;
    if (deviceInHlc !== op.deviceId) {
      ctx.addIssue({ code: "custom", path: ["hlc"], message: "HLC должен нести идентификатор устройства-автора" });
    }
    if (op.entity === "listItem" && !op.parentId) {
      ctx.addIssue({ code: "custom", path: ["parentId"], message: "Пункту нужен parentId (список)" });
    }
    const fieldsError = validateOpFields(op.entity, op.kind, op.fields);
    if (fieldsError) ctx.addIssue({ code: "custom", path: ["fields"], message: fieldsError });
  });
export type SyncOp = z.infer<typeof syncOpSchema>;

/**
 * Проверяет `fields` операции: только разрешённые поля нужного вида, значения по схеме, для `create` —
 * обязательные поля, для `patch` — хотя бы одно поле, для `delete` — ни одного. Возвращает текст ошибки.
 */
export function validateOpFields(entity: SyncEntityType, kind: SyncOpKind, fields: Record<string, unknown> | undefined): string | null {
  if (kind === "delete") return fields && Object.keys(fields).length > 0 ? "У удаления не бывает полей" : null;
  const schemas = FIELD_SCHEMAS[entity];
  if (!fields || Object.keys(fields).length === 0) return kind === "patch" ? "Нечего менять" : "Нет полей";
  for (const [key, value] of Object.entries(fields)) {
    const schema = schemas[key];
    if (!schema) return `Поле «${key}» нельзя менять через синхронизацию`;
    const parsed = schema.safeParse(value);
    if (!parsed.success) return `Поле «${key}»: ${parsed.error.issues[0]?.message ?? "некорректное значение"}`;
  }
  if (kind === "create") {
    for (const required of REQUIRED_ON_CREATE[entity]) {
      if (!(required in fields)) return `Не хватает поля «${required}»`;
    }
  }
  return null;
}

/** Нормализованные значения полей (после trim и пр.), как их увидит узел. */
export function normalizeOpFields(entity: SyncEntityType, fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const schemas = FIELD_SCHEMAS[entity];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    const schema = schemas[key];
    out[key] = schema ? schema.parse(value) : value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Исходы
// ---------------------------------------------------------------------------------------------

export const SYNC_OUTCOMES = ["applied", "merged", "superseded", "duplicate", "conflict", "rejected"] as const;
export const syncOutcomeSchema = z.enum(SYNC_OUTCOMES);
export type SyncOutcome = z.infer<typeof syncOutcomeSchema>;

export const SYNC_REASONS = [
  "exists",
  "entity_deleted",
  "parent_deleted",
  "parent_missing",
  "entity_gone",
  "revision",
  "op_id_reuse",
  "device_rolled_back",
  "device_revoked",
  "hlc_in_future",
  "not_writable",
  "invalid"
] as const;
export const syncReasonSchema = z.enum(SYNC_REASONS);
export type SyncReason = z.infer<typeof syncReasonSchema>;

export const syncOpResultSchema = z.object({
  opId: z.string(),
  outcome: syncOutcomeSchema,
  reason: syncReasonSchema.optional(),
  /** Поля, чьи значения проиграли: имя поля → значение, которое осталось на узле. */
  lost: z.record(z.unknown()).optional(),
  message: z.string().optional()
});
export type SyncOpResult = z.infer<typeof syncOpResultSchema>;

/** Исход, после которого устройство может считать операцию доставленной. */
export function isAckedOutcome(outcome: SyncOutcome): boolean {
  return outcome !== "rejected";
}

// ---------------------------------------------------------------------------------------------
// Запросы и ответы
// ---------------------------------------------------------------------------------------------

export const registerSyncDeviceInputSchema = z.object({
  deviceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80)
});
export type RegisterSyncDeviceInput = z.infer<typeof registerSyncDeviceInputSchema>;

export const syncDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable()
});
export type SyncDevice = z.infer<typeof syncDeviceSchema>;

export const pushSyncOpsInputSchema = z.object({
  protocol: z.number().int(),
  deviceId: z.string().uuid(),
  ops: z.array(syncOpSchema).min(1).max(SYNC_PUSH_MAX_OPS)
});
export type PushSyncOpsInput = z.infer<typeof pushSyncOpsInputSchema>;

export const pushSyncOpsResultSchema = z.object({
  protocol: z.number().int(),
  results: z.array(syncOpResultSchema),
  /** Часы узла: устройство вливает их в свои (`HlcClock.receive`). */
  serverHlc: z.string()
});
export type PushSyncOpsResult = z.infer<typeof pushSyncOpsResultSchema>;

/** Список в копии — без пунктов: пункты едут отдельной сущностью `listItem`. */
export const replicaListSchema = listSchema.omit({ items: true });
export type ReplicaList = z.infer<typeof replicaListSchema>;
export const replicaListItemSchema = listItemSchema;
export type ReplicaListItem = z.infer<typeof replicaListItemSchema>;

/**
 * Документы копии как непрозрачные записи: заметки и задачи валидируются своими схемами на клиенте
 * (`@orion/core`), здесь — только форма. Так контракт протокола не тянет за собой каждую правку DTO.
 */
export const replicaDocSchema = z.object({ id: z.string() }).passthrough();
export type ReplicaDoc = z.infer<typeof replicaDocSchema>;

export const replicaEntitiesSchema = z.object({
  list: z.array(replicaListSchema),
  listItem: z.array(replicaListItemSchema),
  note: z.array(replicaDocSchema),
  task: z.array(replicaDocSchema)
});
export type ReplicaEntities = z.infer<typeof replicaEntitiesSchema>;

export const replicaSnapshotSchema = z.object({
  protocol: z.number().int(),
  workspaceId: z.string(),
  /** Момент снимка на узле (для метки «данные на …»). */
  asOf: z.string(),
  cursor: z.string(),
  serverHlc: z.string(),
  /** Какие сущности вошли в копию (выключенный модуль в неё не попадает). */
  included: z.array(syncEntityTypeSchema),
  entities: replicaEntitiesSchema
});
export type ReplicaSnapshot = z.infer<typeof replicaSnapshotSchema>;

/** Изменение одной сущности: актуальное состояние (`doc`) или признак, что её больше нет в копии (`doc: null`). */
export const replicaChangeSchema = z.object({
  entity: syncEntityTypeSchema,
  id: z.string(),
  parentId: z.string().nullable(),
  doc: z.record(z.unknown()).nullable()
});
export type ReplicaChange = z.infer<typeof replicaChangeSchema>;

export const replicaPullSchema = z.object({
  protocol: z.number().int(),
  asOf: z.string(),
  cursor: z.string(),
  serverHlc: z.string(),
  hasMore: z.boolean(),
  changes: z.array(replicaChangeSchema)
});
export type ReplicaPull = z.infer<typeof replicaPullSchema>;

export const setSyncModeInputSchema = z.object({ mode: syncModeSchema });
export type SetSyncModeInput = z.infer<typeof setSyncModeInputSchema>;

export const syncModeStateSchema = z.object({ mode: syncModeSchema, protocol: z.number().int() });
export type SyncModeState = z.infer<typeof syncModeStateSchema>;

/** Тело ошибок протокола (409/410/426) — клиент различает их по `code`. */
export const syncErrorCodeSchema = z.enum(["sync_mode_not_hybrid", "resync_required", "protocol_unsupported", "device_unknown", "device_revoked", "device_rolled_back"]);
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;

// ---------------------------------------------------------------------------------------------
// Состояния для UI (ADR-0016 §8)
// ---------------------------------------------------------------------------------------------

export type SyncState = "local" | "queued" | "synced" | "conflict";
export const SYNC_STATE_LABELS: Record<SyncState, string> = {
  local: "Только на этом устройстве",
  queued: "В очереди на отправку",
  synced: "Синхронизировано",
  conflict: "Конфликт"
};
