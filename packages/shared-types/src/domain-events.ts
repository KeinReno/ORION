import { z } from "zod";
import type { OrionModuleId } from "./modules";

/**
 * Каталог доменных событий (G3, ADR-0019, docs/platform-api/EVENTS.md). Имя — `<module>.<entity>.<verb>`
 * (прошедшее время), `module` — id модуля-издателя. Схема payload — контракт: `DomainEventBus.publishTx` валидирует
 * её при публикации, диспетчер — при доставке. В payload — только id и минимум полей, без тел заметок и секретов.
 */
export const tasksTaskClosedPayloadSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  /** Новый (закрытый) статус: см. TASK_CLOSED_STATUSES. */
  status: z.string()
});
export type TasksTaskClosedPayload = z.infer<typeof tasksTaskClosedPayloadSchema>;

export interface DomainEventDefinition {
  version: number;
  publisher: OrionModuleId;
  payload: z.ZodType<unknown>;
}

export const DOMAIN_EVENT_CATALOG = {
  "tasks.task.changed": { version: 1, publisher: "tasks", payload: z.object({ id: z.string().min(1) }).strict() },
  "tasks.task.closed": { version: 1, publisher: "tasks", payload: tasksTaskClosedPayloadSchema }
} as const satisfies Record<string, DomainEventDefinition>;

export type DomainEventType = keyof typeof DOMAIN_EVENT_CATALOG;
export const DOMAIN_EVENT_TYPES = Object.keys(DOMAIN_EVENT_CATALOG) as DomainEventType[];

export type DomainEventPayloads = {
  [K in DomainEventType]: z.infer<(typeof DOMAIN_EVENT_CATALOG)[K]["payload"]>;
};

export function isDomainEventType(value: string): value is DomainEventType {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_CATALOG, value);
}

/** Валидирует payload по схеме типа; бросает ZodError, если он не соответствует контракту. */
export function parseDomainEventPayload<T extends DomainEventType>(type: T, payload: unknown): DomainEventPayloads[T] {
  return DOMAIN_EVENT_CATALOG[type].payload.parse(payload) as DomainEventPayloads[T];
}

/** Типы событий, которые публикует модуль, — значение `events.publishes` его манифеста. */
export function domainEventTypesPublishedBy(moduleId: string): string[] {
  return DOMAIN_EVENT_TYPES.filter((type) => DOMAIN_EVENT_CATALOG[type].publisher === moduleId);
}

/** Конверт события, как его видит подписчик. */
export interface DomainEventEnvelope<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  version: number;
  workspaceId: string;
  actorId: string | null;
  occurredAt: string;
  payload: DomainEventPayloads[T];
}

/**
 * Объявленные подписки (источник для `events.subscribes` манифестов). Обработчик регистрируется в коде API
 * (`DomainEventBus.subscribe`) и обязан совпасть с записью здесь по `id`, `componentId` и `types` — иначе
 * регистрация падает при старте. `componentId` — id модуля или плагина-владельца: если он выключен в пространстве,
 * доставка пропускается (`skipped_disabled`).
 */
export interface DomainEventSubscription {
  id: string;
  componentId: string;
  types: readonly DomainEventType[];
}

export const DOMAIN_EVENT_SUBSCRIPTIONS = [
  { id: "tasks.publish-selected-tasks", componentId: "tasks", types: ["tasks.task.changed"] },
  { id: "tasks.notify-assignee-on-close", componentId: "tasks", types: ["tasks.task.closed"] }
] as const satisfies readonly DomainEventSubscription[];

export function domainEventTypesSubscribedBy(componentId: string): string[] {
  const types = new Set<string>();
  for (const sub of DOMAIN_EVENT_SUBSCRIPTIONS) if (sub.componentId === componentId) sub.types.forEach((t) => types.add(t));
  return [...types];
}
