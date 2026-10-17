import { RELATION_KIND_CATALOG, isRelationPairAllowed, type RelationKind, type SearchableEntityType } from "@orion/shared-types";

/**
 * A single candidate->link option the picker can offer: `sourceType/sourceId`
 * is always the actual DB source of the row that would be created (not
 * necessarily "this" entity — a directed kind like `supports` only stores
 * `note -> task`, so linking a note from a task's own picker has to create
 * the row the other way round). `perspectiveLabel` is what "this" entity's
 * side should read: `label` when "this" is the source, `reverseLabel` when
 * "this" is the target — see 23-UNIVERSAL-CONNECTED-CORE.md "Интерфейс
 * связанного контекста" ("покажи reverse label каталога на стороне цели связи").
 *
 * Pulled out of `entity-links.tsx` (a client component, not covered by the
 * root vitest config) so the direction/label logic — the actual new behavior
 * U02 adds on top of U01's catalog — has a unit test.
 */
export interface EntityLinkOption {
  kind: RelationKind;
  sourceType: SearchableEntityType;
  sourceId: string;
  targetType: SearchableEntityType;
  targetId: string;
  perspectiveLabel: string;
}

const ALL_KINDS: RelationKind[] = ["supports", "evidence_for", "goal_step", "goal_measure", "goal_material", "goal_risk", "goal_prerequisite", "related_to"];

export function computeLinkOptions(
  thisType: SearchableEntityType,
  thisId: string,
  otherType: SearchableEntityType,
  otherId: string
): EntityLinkOption[] {
  const options: EntityLinkOption[] = [];
  for (const kind of ALL_KINDS) {
    const def = RELATION_KIND_CATALOG[kind];
    if (def.symmetric) {
      if (isRelationPairAllowed(kind, thisType, otherType)) {
        options.push({ kind, sourceType: thisType, sourceId: thisId, targetType: otherType, targetId: otherId, perspectiveLabel: def.label });
      }
      continue;
    }
    // Directed: "this" as source (this supports/evidences other).
    if (isRelationPairAllowed(kind, thisType, otherType)) {
      options.push({ kind, sourceType: thisType, sourceId: thisId, targetType: otherType, targetId: otherId, perspectiveLabel: def.label });
    }
    // Directed: "this" as target (other supports/evidences this) — shown with the reverse label.
    if (isRelationPairAllowed(kind, otherType, thisType)) {
      options.push({ kind, sourceType: otherType, sourceId: otherId, targetType: thisType, targetId: thisId, perspectiveLabel: def.reverseLabel });
    }
  }
  return options;
}
