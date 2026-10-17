import {
  hlcFromMs,
  normalizeOpFields,
  parseHlc,
  syncFieldNames,
  SYNC_MAX_CLOCK_SKEW_MS,
  type SyncEntityType,
  type SyncOp,
  type SyncOutcome,
  type SyncReason
} from "./hybrid-sync";

/**
 * ТЗ-06 / ADR-0016 §3 — решение узла по одной операции. ЧИСТАЯ функция: ничего не читает и не пишет,
 * поэтому её гоняет и серверная служба (поверх Prisma), и тест сходимости (поверх памяти), и это одно и
 * то же правило слияния. Узел вызывает её под блокировкой по сущности/пространству, так что решения
 * сериализованы; порядок прихода операций на результат влияет только через штампы HLC полей.
 */
export interface MergeEntityState {
  /** Строка существует сейчас. */
  exists: boolean;
  /** Строки нет, но в ленте есть запись об удалении (tombstone ещё хранится). */
  deleted: boolean;
  /** Штампы HLC полей, которые писал sync. */
  stamps: Record<string, string>;
  /** `updatedAt` строки — штамп-замена для полей, которые писал обычный REST. */
  updatedAtMs: number;
  /** Текущие значения полей (только те, которыми управляет sync). */
  fields: Record<string, unknown>;
  /** Ревизия (заметки/задачи). */
  revision?: number;
}

export interface MergeParentState {
  exists: boolean;
  deleted: boolean;
}

export interface MergeDecision {
  outcome: SyncOutcome;
  reason?: SyncReason;
  /** Создать строку с этими полями (все со штампом HLC операции). */
  create?: Record<string, unknown>;
  /** Записать эти поля в существующую строку. */
  set?: Record<string, unknown>;
  /** Новые штампы (поле → HLC). */
  stamps?: Record<string, string>;
  /** Удалить строку. */
  remove?: boolean;
  /** Проигравшие поля: имя → значение, оставшееся на узле. */
  lost?: Record<string, unknown>;
}

const reject = (reason: SyncReason): MergeDecision => ({ outcome: "rejected", reason });
const conflict = (reason: SyncReason): MergeDecision => ({ outcome: "conflict", reason });

export function decideOp(
  op: Pick<SyncOp, "entity" | "kind" | "hlc" | "fields" | "expectedRevision">,
  state: MergeEntityState,
  parent: MergeParentState | null,
  nowMs: number
): MergeDecision {
  const authored = parseHlc(op.hlc);
  if (!authored) return reject("invalid");
  if (authored.wallMs > nowMs + SYNC_MAX_CLOCK_SKEW_MS) return reject("hlc_in_future");

  if (op.kind === "delete") {
    // Удаление идемпотентно: уже нет — значит, уже удалено (или никогда не было — тоже не ошибка).
    return state.exists ? { outcome: "applied", remove: true } : { outcome: "duplicate", reason: "entity_gone" };
  }

  const fields = normalizeOpFields(op.entity, op.fields);

  if (op.kind === "create") {
    if (state.deleted) return conflict("entity_deleted");
    if (state.exists) return { outcome: "duplicate", reason: "exists" };
    if (requiresParent(op.entity)) {
      if (!parent) return reject("parent_missing");
      if (parent.deleted) return conflict("parent_deleted");
      if (!parent.exists) return reject("parent_missing");
    }
    // Поля, не названные в операции, получили значения по умолчанию в тот же момент — тоже со штампом создания.
    return { outcome: "applied", create: fields, stamps: stampAll(Object.fromEntries(syncFieldNames(op.entity).map((name) => [name, null])), op.hlc) };
  }

  // patch
  if (!state.exists) return state.deleted ? conflict("entity_deleted") : reject("entity_gone");
  if (requiresParent(op.entity) && parent?.deleted) return conflict("parent_deleted");

  // Заметка: слияния нет, только CAS. Задача: CAS только если автор его запросил.
  if (op.entity === "note" && op.expectedRevision === undefined) return reject("invalid");
  if (op.expectedRevision !== undefined && state.revision !== undefined && op.expectedRevision !== state.revision) {
    return conflict("revision");
  }
  if (op.entity === "note") {
    return { outcome: "applied", set: fields, stamps: stampAll(fields, op.hlc) };
  }
  const stampable = syncFieldNames(op.entity);

  const set: Record<string, unknown> = {};
  const stamps: Record<string, string> = {};
  const lost: Record<string, unknown> = {};
  const fallback = hlcFromMs(state.updatedAtMs);
  for (const [name, value] of Object.entries(fields)) {
    const current = state.stamps[name] ?? fallback;
    if (op.hlc > current) {
      set[name] = value;
      stamps[name] = op.hlc;
    } else if (valuesEqual(state.fields[name], value)) {
      // Проиграл по времени, но значение то же — конфликта человеку показывать нечего.
      continue;
    } else {
      lost[name] = state.fields[name];
    }
  }
  // Заморозка: поле без штампа (его писал REST) получает штамп «времени последней записи строки» ДО того,
  // как эта операция сдвинет `updatedAt` — иначе чужая запись в другое поле выглядела бы свежей правкой этого.
  for (const name of stampable) {
    if (state.stamps[name] === undefined && stamps[name] === undefined) stamps[name] = fallback;
  }
  const lostCount = Object.keys(lost).length;
  const wonCount = Object.keys(set).length;
  if (lostCount === 0) return { outcome: "applied", set, stamps };
  if (wonCount === 0) return { outcome: "superseded", lost };
  return { outcome: "merged", set, stamps, lost };
}

function requiresParent(entity: SyncEntityType): boolean {
  return entity === "listItem";
}

function stampAll(fields: Record<string, unknown>, hlc: string): Record<string, string> {
  return Object.fromEntries(Object.keys(fields).map((name) => [name, hlc]));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Стабильный хэш тела операции для `op_id_reuse` (sha256 считает вызывающий — здесь только каноническая строка). */
export function canonicalOpBody(op: SyncOp): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, inner]) => [key, sorted(inner)])
      );
    }
    return value;
  };
  return JSON.stringify(sorted({ ...op, opId: undefined }));
}
