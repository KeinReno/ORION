import { z } from "zod";
import { createNoteInputSchema } from "./note";
import { createTaskInputSchema } from "./task";

export const searchableEntityTypeSchema = z.enum(["project", "task", "note", "event", "document", "transaction"]);
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
export const relationKindSchema = z.enum(["related_to", "supports", "evidence_for"]);
export type RelationKind = z.infer<typeof relationKindSchema>;

export interface RelationKindDefinition {
  /** True for a link with no meaningful direction (A<->B is one fact, not two). */
  symmetric: boolean;
  /** Any pair of distinct registered types is valid for this kind (only `related_to` today). */
  allowAnyPair?: boolean;
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
  }
};

/** Whether `sourceType -> targetType` is an allowed pair for `kind`, in the given direction. */
export function isRelationPairAllowed(kind: RelationKind, sourceType: SearchableEntityType, targetType: SearchableEntityType): boolean {
  const def = RELATION_KIND_CATALOG[kind];
  if (def.allowAnyPair) return sourceType !== targetType;
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
    label: z.string().max(120).nullable().optional()
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
