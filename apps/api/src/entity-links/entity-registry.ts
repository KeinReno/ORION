import type { Prisma } from "@prisma/client";
import type { OrionModuleId, OrionPluginId, SearchableEntityType } from "@orion/shared-types";
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
  pluginId?: OrionPluginId;
  /** Safe display summary, or `null` if the row doesn't exist or isn't owned by `workspaceId`. */
  summary(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<string | null>;
}

export const ENTITY_REGISTRY: Record<SearchableEntityType, EntityAdapter> = {
  goal: {
    moduleId: SEARCH_TYPE_MODULE.goal,
    pluginId: "projects-goals",
    async summary(tx, workspaceId, id) {
      const row = await tx.goal.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
      return owned(row, workspaceId, "title");
    }
  },
  savings_goal: {
    moduleId: SEARCH_TYPE_MODULE.savings_goal,
    pluginId: "finance-goals",
    async summary(tx, workspaceId, id) {
      const row = await tx.savingsGoal.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
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
  account: {
    moduleId: SEARCH_TYPE_MODULE.account,
    async summary(tx, workspaceId, id) {
      const row = await tx.account.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
  contact: {
    moduleId: SEARCH_TYPE_MODULE.contact,
    async summary(tx, workspaceId, id) {
      const row = await tx.contact.findUnique({ where: { id }, select: { workspaceId: true, name: true } });
      return owned(row, workspaceId, "name");
    }
  },
  // Задание 05: запись журнала проекта связуема с материалами (Knowledge, Documents,
  // Notes) через общий EntityLink. Сводка — первые 80 символов текста: у записи нет
  // отдельного заголовка, а RLS/проверка workspace отсекают чужую строку.
  project_log_entry: {
    moduleId: SEARCH_TYPE_MODULE.project_log_entry,
    pluginId: "projects-logbook",
    async summary(tx, workspaceId, id) {
      const row = await tx.projectLogEntry.findUnique({ where: { id }, select: { workspaceId: true, text: true } });
      const text = owned(row, workspaceId, "text");
      if (text === null) return null;
      const line = text.trim().split("\n")[0] ?? "";
      return line.length > 80 ? `${line.slice(0, 77)}…` : line || "Запись журнала";
    }
  },
  // Задание 06/10: материал базы знаний — такая же связуемая сущность, как заметка.
  // Приватный материал другого автора отсекает RLS, поэтому `summary` вернёт null.
  knowledge_item: {
    moduleId: SEARCH_TYPE_MODULE.knowledge_item,
    async summary(tx, workspaceId, id) {
      const row = await tx.knowledgeItem.findUnique({ where: { id }, select: { workspaceId: true, title: true } });
      return owned(row, workspaceId, "title");
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