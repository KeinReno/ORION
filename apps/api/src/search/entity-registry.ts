import type { Prisma } from "@prisma/client";
import type { OrionModuleId, SearchableEntityType } from "@orion/shared-types";
import { SEARCH_TYPE_MODULE } from "@orion/shared-types";

/**
 * U01 (24-CONNECTED-CORE-BACKLOG.md): closed adapter registry for the five
 * entity types EntityLink can reference (contacts joined with the «Контакты» module). 23-UNIVERSAL-CONNECTED-CORE.md is
 * explicit that no generic endpoint accepts a client-chosen table name — this
 * is the one place that maps a `SearchableEntityType` id to real Prisma calls,
 * so a new type means one new adapter (+ tests), not a new code path per
 * caller. `summary()` never throws and never leaks a title for a row that
 * doesn't belong to `workspaceId` — it returns `null`, matching "недоступный/
 * удалённый объект не раскрывает бывшее название неавторизованному
 * пользователю".
 */
export interface EntityAdapter {
  moduleId: OrionModuleId;
  /** Safe display summary, or `null` if the row doesn't exist or isn't owned by `workspaceId`. */
  summary(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<string | null>;
}

export const ENTITY_REGISTRY: Record<SearchableEntityType, EntityAdapter> = {
  project: {
    moduleId: SEARCH_TYPE_MODULE.project,
    async summary(tx, workspaceId, id) {
      const row = await tx.project.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
  task: {
    moduleId: SEARCH_TYPE_MODULE.task,
    async summary(tx, workspaceId, id) {
      const row = await tx.task.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
      return owned(row, workspaceId, "title");
    }
  },
  note: {
    moduleId: SEARCH_TYPE_MODULE.note,
    async summary(tx, workspaceId, id) {
      const row = await tx.note.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
      return owned(row, workspaceId, "title");
    }
  },
  event: {
    moduleId: SEARCH_TYPE_MODULE.event,
    async summary(tx, workspaceId, id) {
      const row = await tx.event.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
      return owned(row, workspaceId, "title");
    }
  },
  document: {
    moduleId: SEARCH_TYPE_MODULE.document,
    async summary(tx, workspaceId, id) {
      const row = await tx.document.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
  transaction: {
    moduleId: SEARCH_TYPE_MODULE.transaction,
    async summary(tx, workspaceId, id) {
      const row = await tx.transaction.findUnique({ where: { id }, select: { workspaceId: true, note: true } });
      const title = owned(row, workspaceId, "note");
      if (title === null) return null;
      return title || "Финансовая операция";
    }
  },
  list: {
    moduleId: SEARCH_TYPE_MODULE.list,
    async summary(tx, workspaceId, id) {
      const row = await tx.list.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
  contact: {
    moduleId: SEARCH_TYPE_MODULE.contact,
    async summary(tx, workspaceId, id) {
      const row = await tx.contact.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  }
};

function owned<T extends { workspaceId: string }, K extends keyof T>(row: T | null, workspaceId: string, key: K): string | null {
  if (!row || row.workspaceId !== workspaceId) return null;
  return String(row[key] ?? "");
}

/** `canRead`/`canLink` today both reduce to "the type's module is enabled/accessible for this actor" — there is no finer per-link permission model yet. */
export function canAccessType(accessible: Set<OrionModuleId>, type: SearchableEntityType): boolean {
  return accessible.has(ENTITY_REGISTRY[type].moduleId);
}
