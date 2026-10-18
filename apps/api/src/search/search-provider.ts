import type { Prisma } from "@prisma/client";
import type { GlobalSearchResult, OrionModuleId, SearchableEntityType } from "@orion/shared-types";

/**
 * G19: глобальный поиск не знает таблиц предметных модулей — каждый модуль (или плагин) сам регистрирует провайдера
 * своего типа сущности из своей директории (`SearchProviderRegistry.register`, обычно в `onModuleInit`). Ядро
 * (`SearchService`) только агрегирует. Доступ по модулю/плагину решает ядро (`accessibleTypesTx` по `ENTITY_REGISTRY`),
 * провайдер о нём не знает и вызывается уже внутри `withUser`-транзакции после проверки членства.
 */
export interface SearchProvider {
  /** Тип сущности, который отдаёт провайдер; один провайдер на тип. */
  readonly entityType: SearchableEntityType;
  /** Модуль-владелец (для диагностики и проверки, что провайдер зарегистрирован своим модулем). */
  readonly componentId: OrionModuleId;
  /** Не больше `limit` результатов, новые выше; запрос уже обрезан и не короче двух символов. */
  search(tx: Prisma.TransactionClient, workspaceId: string, query: string, limit: number): Promise<GlobalSearchResult[]>;
}

/** Сколько записей каждый провайдер отдаёт в общую выдачу (как было до выноса провайдеров). */
export const SEARCH_PROVIDER_LIMIT = 8;

/**
 * Порядок склейки выдачи до сортировки по релевантности. `Array.sort` стабилен, поэтому при равном ранге и дате порядок
 * определяют именно эти позиции — фиксируем их здесь, а не порядком инициализации модулей Nest.
 */
export const SEARCH_PROVIDER_ORDER: readonly SearchableEntityType[] = [
  "project", "task", "note", "event", "document", "transaction", "contact", "list", "goal", "account", "savings_goal"
];

/** Собирает DTO результата; `matchedText` режется до 240 символов, `updatedAt` — ISO. */
export function searchResult(
  type: GlobalSearchResult["type"],
  id: string,
  title: string,
  subtitle: string,
  matchedText: string,
  projectId: string | null,
  updatedAt: Date
): GlobalSearchResult {
  return { id, type, title, subtitle, matchedText: matchedText.slice(0, 240), projectId, updatedAt: updatedAt.toISOString() };
}

/** Русская подпись статуса проекта/задачи для подзаголовка результата. */
export function searchStatusLabel(status: string): string {
  return ({ active: "Активный проект", on_hold: "На паузе", completed: "Завершён", backlog: "Бэклог", todo: "К выполнению", in_progress: "В работе", done: "Готово", canceled: "Отменено" } as Record<string, string>)[status] ?? status;
}
