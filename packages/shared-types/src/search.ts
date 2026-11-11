import { z } from "zod";
import { orionModuleIdSchema } from "./modules";
import { createNoteInputSchema } from "./note";
import { createTaskInputSchema } from "./task";

export const searchableEntityTypeSchema = z.enum([
  "project", "task", "note", "event", "document", "transaction", "contact", "list", "account", "goal", "savings_goal",
  // Задание 05: запись журнала проекта — такая же связуемая сущность, как заметка
  // или документ. Материалы прикрепляются только через EntityLink, без копий в записи.
  "project_log_entry",
  // Задание 10: материал базы знаний — отдельный тип, а не «документ»: у него
  // свои статус, источники и проверка (задание 06).
  "knowledge_item"
]);
export type SearchableEntityType = z.infer<typeof searchableEntityTypeSchema>;

export const globalSearchResultSchema = z.object({
  id: z.string(),
  type: searchableEntityTypeSchema,
  title: z.string(),
  subtitle: z.string(),
  matchedText: z.string(),
  projectId: z.string().nullable(),
  updatedAt: z.string()
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

/**
 * U01 (24-CONNECTED-CORE-BACKLOG.md): closed catalog of relation "kinds" —
 * stable ids, never the free-text `label`. First slice, as specified in
 * 23-UNIVERSAL-CONNECTED-CORE.md "Общий контракт сущности и связи":
 *
 * - `related_to` — symmetric, any pair among the five registered types.
 * - `supports` — directed, a note/document is "material for" a task.
 * - `evidence_for` — directed, a document confirms a finance transaction.
 *
 * Adding a new kind means adding a catalog entry (+ its own tests) — it does
 * not touch storage shape for the existing kinds.
 */
export const relationKindSchema = z.enum([
  "related_to",
  "supports",
  "evidence_for",
  "goal_step",
  "goal_measure",
  "goal_material",
  "goal_risk",
  "goal_prerequisite",
  // Foundation Core (task 01): универсальные типы связей единого слоя EntityLinksService.
  "blocks",
  "depends_on",
  "relates_to",
  "continues",
  "replaces",
  "duplicates",
  "references"
]);
export type RelationKind = z.infer<typeof relationKindSchema>;

export interface RelationKindDefinition {
  /** True for a link with no meaningful direction (A<->B is one fact, not two). */
  symmetric: boolean;
  /** Any pair of registered types is valid for this kind (both endpoints must still be distinct rows). */
  allowAnyPair?: boolean;
  /** Allow same-type pairs (task -> task `depends_on`). Without it `allowAnyPair` implies different types. */
  allowSameType?: boolean;
  /** Directed `[source, target]` pairs valid for this kind when `allowAnyPair` is not set. */
  allowedPairs?: ReadonlyArray<readonly [SearchableEntityType, SearchableEntityType]>;
  /** Russian label shown from the source's side. */
  label: string;
  /** Russian label shown from the target's side (only meaningful for directed kinds). */
  reverseLabel: string;
}

export const RELATION_KIND_CATALOG: Record<RelationKind, RelationKindDefinition> = {
  related_to: {
    symmetric: true,
    allowAnyPair: true,
    label: "связано с",
    reverseLabel: "связано с"
  },
  supports: {
    symmetric: false,
    allowedPairs: [
      ["note", "task"],
      ["document", "task"]
    ],
    label: "материал для",
    reverseLabel: "использует материал"
  },
  evidence_for: {
    symmetric: false,
    allowedPairs: [["document", "transaction"]],
    label: "подтверждает расход",
    reverseLabel: "подтверждается документом"
  },
  goal_step: {
    symmetric: false,
    allowedPairs: [["task", "goal"], ["event", "goal"], ["list", "goal"]],
    label: "шаг к цели",
    reverseLabel: "шаг"
  },
  goal_measure: {
    symmetric: false,
    allowedPairs: [["account", "goal"], ["transaction", "goal"], ["savings_goal", "goal"]],
    label: "показатель цели",
    reverseLabel: "показатель"
  },
  goal_material: {
    symmetric: false,
    allowedPairs: [["note", "goal"], ["document", "goal"], ["contact", "goal"], ["list", "goal"], ["project", "goal"]],
    label: "материал для цели",
    reverseLabel: "материал"
  },
  goal_risk: {
    symmetric: false,
    allowedPairs: [["task", "goal"], ["event", "goal"], ["note", "goal"], ["document", "goal"], ["transaction", "goal"]],
    label: "риск для цели",
    reverseLabel: "риск"
  },
  goal_prerequisite: {
    symmetric: false,
    allowedPairs: [["goal", "goal"]],
    label: "должна завершиться до",
    reverseLabel: "зависит от"
  },
  // Foundation Core (task 01): универсальный слой связей. Пары не ограничены типом, потому что
  // EntityLinksService связывает любые зарегистрированные сущности одного пространства; смысл
  // задаёт направление, а не таблица-владелец.
  blocks: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "блокирует",
    reverseLabel: "блокируется"
  },
  depends_on: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "зависит от",
    reverseLabel: "нужен для"
  },
  relates_to: {
    symmetric: true,
    allowAnyPair: true,
    allowSameType: true,
    label: "связано с",
    reverseLabel: "связано с"
  },
  continues: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "продолжает",
    reverseLabel: "продолжается"
  },
  replaces: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "заменяет",
    reverseLabel: "заменено"
  },
  duplicates: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "дублирует",
    reverseLabel: "дубликат"
  },
  references: {
    symmetric: false,
    allowAnyPair: true,
    allowSameType: true,
    label: "ссылается на",
    reverseLabel: "упоминается"
  }
};

/** Все допустимые значения `EntityLink.kind` (и Prisma-enum `EntityLinkKind`) — единый список. */
export const RELATION_KINDS = Object.keys(RELATION_KIND_CATALOG) as RelationKind[];

/** Виды, для которых EntityLinksService проверяет отсутствие цикла в транзакции. */
export const RELATION_CYCLE_KINDS: ReadonlySet<RelationKind> = new Set(["depends_on", "blocks", "goal_prerequisite"]);

/** Whether `sourceType -> targetType` is an allowed pair for `kind`, in the given direction. */
export function isRelationPairAllowed(kind: RelationKind, sourceType: SearchableEntityType, targetType: SearchableEntityType): boolean {
  const def = RELATION_KIND_CATALOG[kind];
  if (def.allowAnyPair) return sourceType !== targetType || (def.allowSameType ?? false);
  return (def.allowedPairs ?? []).some(([s, t]) => s === sourceType && t === targetType);
}

/**
 * For a symmetric kind, canonicalizes endpoint order so `A->B` and `B->A`
 * always store as the same row — sorted lexicographically by `(type, id)`.
 * Directed kinds are returned unchanged: `task supports project` and
 * `project supports task` are different facts, not the same link reordered.
 */
export function canonicalizeEndpoints(
  kind: RelationKind,
  source: { type: SearchableEntityType; id: string },
  target: { type: SearchableEntityType; id: string }
): { source: { type: SearchableEntityType; id: string }; target: { type: SearchableEntityType; id: string } } {
  if (!RELATION_KIND_CATALOG[kind].symmetric) return { source, target };
  const sourceKey = `${source.type}:${source.id}`;
  const targetKey = `${target.type}:${target.id}`;
  return sourceKey <= targetKey ? { source, target } : { source: target, target: source };
}

export const entityLinkSchema = z.object({
  id: z.string(),
  sourceType: searchableEntityTypeSchema,
  sourceId: z.string(),
  targetType: searchableEntityTypeSchema,
  targetId: z.string(),
  kind: relationKindSchema,
  label: z.string().nullable(),
  /** true для симметричных видов: A<->B — один факт, обратной строки нет. */
  bidirectional: z.boolean(),
  title: z.string(),
  createdAt: z.string()
});
export type EntityLink = z.infer<typeof entityLinkSchema>;

/** Cursor page, newest-first — same shape as `TaskCommentPage`/`TimeEntryPage` (S15/S17). */
export const entityLinkPageSchema = z.object({
  items: z.array(entityLinkSchema),
  nextCursor: z.string().nullable()
});
export type EntityLinkPage = z.infer<typeof entityLinkPageSchema>;

export const createEntityLinkInputSchema = z
  .object({
    sourceType: searchableEntityTypeSchema,
    sourceId: z.string(),
    targetType: searchableEntityTypeSchema,
    targetId: z.string(),
    kind: relationKindSchema.default("related_to"),
    label: z.string().max(120).nullable().optional(),
    /** Допустим только для симметричных видов (relates_to/related_to); для остальных — 400. */
    bidirectional: z.boolean().optional()
  })
  .refine((value) => value.sourceType !== value.targetType || value.sourceId !== value.targetId, {
    message: "Нельзя связать объект с самим собой"
  });
export type CreateEntityLinkInput = z.infer<typeof createEntityLinkInputSchema>;

/**
 * U03 Часть 1 (24-CONNECTED-CORE-BACKLOG.md): "Создать задачу"/"Написать
 * заметку" from an entity's related-records picker. The new entity and its
 * link to `target` are created in ONE server transaction (`SearchService.
 * createAndLink`) — not two sequential HTTP calls — so a mid-flight failure
 * never leaves a created task/note with no link, or a link with no entity
 * behind it. Only `task`/`note` are wired up today; `document` needs its own
 * upload-durability story (multipart + storage write) and is deliberately
 * left out of this slice — see 12-PROGRESS.md U03.
 *
 * `idempotencyKey` is accepted and echoed back but NOT deduplicated
 * server-side (no dedup table for this narrow slice) — the only guard
 * against a double-submit is the client disabling its submit button
 * immediately on click (`apps/web/components/create-and-link-form.tsx`).
 * A real network retry after a timeout can still create a second object;
 * this is a documented, accepted gap at this budget, same class of
 * compromise as elsewhere in the project's v0.
 */
export const createAndLinkInputSchema = z.object({
  targetType: searchableEntityTypeSchema,
  targetId: z.string(),
  kind: relationKindSchema.default("related_to"),
  idempotencyKey: z.string().max(100).optional(),
  entity: z.discriminatedUnion("type", [
    z.object({ type: z.literal("task"), input: createTaskInputSchema }),
    z.object({ type: z.literal("note"), input: createNoteInputSchema })
  ])
});
export type CreateAndLinkInput = z.infer<typeof createAndLinkInputSchema>;

export const createAndLinkResultSchema = z.object({
  entityType: searchableEntityTypeSchema,
  entityId: z.string(),
  link: entityLinkSchema
});
export type CreateAndLinkResult = z.infer<typeof createAndLinkResultSchema>;


/** Узел графа связей: тип + id. Одна и та же сущность — один ключ независимо от стороны связи. */
export interface RelationEndpoint {
  type: SearchableEntityType;
  id: string;
}

export function relationNodeKey(endpoint: RelationEndpoint): string {
  return `${endpoint.type}:${endpoint.id}`;
}

export interface RelationEdge {
  source: RelationEndpoint;
  target: RelationEndpoint;
}

/**
 * Замкнётся ли граф, если добавить ребро `source -> target`. Направление ребра — то, как оно
 * хранится в `entity_links`; для `depends_on`/`blocks`/`goal_prerequisite` этого достаточно:
 * цикл есть тогда и только тогда, когда из `target` уже достижим `source` (путь замыкает новое ребро).
 * Чистая функция: сервис передаёт сюда только рёбра того же вида в этом пространстве.
 */
export function wouldCreateRelationCycle(
  edges: readonly RelationEdge[],
  source: RelationEndpoint,
  target: RelationEndpoint
): boolean {
  if (relationNodeKey(source) === relationNodeKey(target)) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const from = relationNodeKey(edge.source);
    const to = relationNodeKey(edge.target);
    outgoing.set(from, [...(outgoing.get(from) ?? []), to]);
  }
  const goal = relationNodeKey(source);
  const pending = [relationNodeKey(target)];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === goal) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

/**
 * Адрес записи, которую вернул поиск. Совпадает по смыслу с `ObjectRef`
 * (`object-navigation.ts`): контракт навигации, а не право доступа.
 */
export const searchDeepLinkSchema = z
  .object({
    workspaceId: z.string().min(1),
    entityType: searchableEntityTypeSchema,
    entityId: z.string().min(1)
  })
  .strict();
export type SearchDeepLink = z.infer<typeof searchDeepLinkSchema>;

/**
 * Запрос единого входа `GET /search?workspaceId=&q=&types=&from=&to=&limit=`.
 * `types` — закрытый список типов; пусто = все доступные модули. `from`/`to`
 * фильтруют по `updatedAt` (включительно).
 */
export const globalSearchQuerySchema = z
  .object({
    workspaceId: z.string().min(1),
    q: z.string().trim().min(1).max(200),
    types: z.array(searchableEntityTypeSchema).min(1).optional(),
    from: z.string().trim().min(1).max(40).optional(),
    to: z.string().trim().min(1).max(40).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict();
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

/**
 * Результат единого входа: к полям провайдера добавлены модуль-источник
 * (метка для интерфейса) и адрес записи. Права провайдер применяет сам —
 * инфраструктура не подменяет их.
 */
export const globalSearchHitSchema = globalSearchResultSchema.extend({
  module: orionModuleIdSchema,
  moduleLabel: z.string(),
  deepLink: searchDeepLinkSchema
});
export type GlobalSearchHit = z.infer<typeof globalSearchHitSchema>;

export const globalSearchResponseSchema = z.object({
  query: z.string(),
  workspaceId: z.string(),
  results: z.array(globalSearchHitSchema)
});
export type GlobalSearchResponse = z.infer<typeof globalSearchResponseSchema>;
