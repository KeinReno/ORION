import { z } from "zod";
import { SEARCH_TYPE_MODULE, type OrionModuleId } from "./modules";
import { searchableEntityTypeSchema, type SearchableEntityType } from "./search";

/**
 * ADR-0014 — a pointer at one object of any module for the context panel («Ресурсы / Связи /
 * Свойства»). `workspaceId` is deliberately absent: it always comes from the active context, so a
 * reference can never address another workspace. `moduleId` is derived from the entity type
 * (`SEARCH_TYPE_MODULE`) and never trusted from a client.
 */
export const entityRefSchema = z.object({
  moduleId: z.string(),
  entityType: searchableEntityTypeSchema,
  entityId: z.string().min(1)
});
export type EntityRef = { moduleId: OrionModuleId; entityType: SearchableEntityType; entityId: string };

export function entityRefOf(entityType: SearchableEntityType, entityId: string): EntityRef {
  return { moduleId: SEARCH_TYPE_MODULE[entityType], entityType, entityId };
}

export function sameEntityRef(a: EntityRef | null | undefined, b: EntityRef | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.entityType === b.entityType && a.entityId === b.entityId;
}
