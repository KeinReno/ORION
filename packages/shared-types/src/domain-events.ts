import { z } from "zod";
import type { OrionModuleId } from "./modules";
import { relationKindSchema, searchableEntityTypeSchema } from "./search";

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

/**
 * Поля группировки bulk-операции (задание 05). Один пользовательский жест,
 * затронувший N записей, публикует N событий с общим `bulkId`; подписчик
 * журнала пишет ОДНУ автозапись на `bulkId`, а не N. `bulkLabel` — готовая
 * человекочитаемая сводка для этой записи (если издатель её знает).
 */
const bulkFields = {
  bulkId: z.string().min(1).optional(),
  bulkLabel: z.string().max(500).optional()
};

export const projectsProjectStatusChangedPayloadSchema = z.object({
  id: z.string().min(1),
  from: z.string(),
  to: z.string(),
  ...bulkFields
});
export type ProjectsProjectStatusChangedPayload = z.infer<typeof projectsProjectStatusChangedPayloadSchema>;

export const projectsProjectDatesChangedPayloadSchema = z.object({
  id: z.string().min(1),
  startAtFrom: z.string().nullable(),
  startAtTo: z.string().nullable(),
  dueAtFrom: z.string().nullable(),
  dueAtTo: z.string().nullable(),
  ...bulkFields
});
export type ProjectsProjectDatesChangedPayload = z.infer<typeof projectsProjectDatesChangedPayloadSchema>;

export const projectsMilestoneCompletedPayloadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  ...bulkFields
});
export type ProjectsMilestoneCompletedPayload = z.infer<typeof projectsMilestoneCompletedPayloadSchema>;

export const projectsMilestoneDatesChangedPayloadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  ...bulkFields
});
export type ProjectsMilestoneDatesChangedPayload = z.infer<typeof projectsMilestoneDatesChangedPayloadSchema>;

/**
 * Задание 03: проект изменён (одно или несколько полей). `changes` — то же
 * «было → стало», что лежит в audit trail: получателю не нужно читать чужую
 * таблицу истории и угадывать, что именно поменялось. Значения — строки (даты
 * ISO), потому что поле бывает и строкой, и числом, и датой.
 */
export const projectsProjectHistoryChangeSchema = z.object({
  field: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().nullable()
});
export type ProjectsProjectHistoryChange = z.infer<typeof projectsProjectHistoryChangeSchema>;

export const projectsProjectUpdatedPayloadSchema = z.object({
  id: z.string().min(1),
  changes: z.array(projectsProjectHistoryChangeSchema).min(1),
  ...bulkFields
});
export type ProjectsProjectUpdatedPayload = z.infer<typeof projectsProjectUpdatedPayloadSchema>;

/** Задание 03: сменился родитель проекта в дереве. */
export const projectsProjectParentChangedPayloadSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  previousParentId: z.string().nullable()
});
export type ProjectsProjectParentChangedPayload = z.infer<typeof projectsProjectParentChangedPayloadSchema>;

export const tasksTaskAssignedPayloadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  assigneeId: z.string().min(1),
  previousAssigneeId: z.string().nullable(),
  ...bulkFields
});
export type TasksTaskAssignedPayload = z.infer<typeof tasksTaskAssignedPayloadSchema>;

export const tasksTaskStatusChangedPayloadSchema = z
  .object({
    id: z.string(),
    fromStatus: z.string(),
    toStatus: z.string(),
    statusId: z.string().nullable()
  })
  .strict();

export const tasksTaskBulkAppliedPayloadSchema = z
  .object({
    operation: z.string(),
    taskIds: z.array(z.string()).max(200),
    applied: z.number().int(),
    failed: z.number().int(),
    allowPartial: z.boolean()
  })
  .strict();

export const tasksRecurrenceInstanceCompletedPayloadSchema = z
  .object({
    ruleId: z.string(),
    previousTaskId: z.string(),
    nextTaskId: z.string(),
    ordinal: z.number().int()
  })
  .strict();

export const tasksRecurrenceSkippedPayloadSchema = z
  .object({
    ruleId: z.string(),
    taskId: z.string(),
    nextTaskId: z.string().nullable(),
    scheduledFor: z.string()
  })
  .strict();

/** Публикатор `core` — инфраструктура платформы, у которой нет id пользовательского модуля. */
export type DomainEventPublisher = OrionModuleId | "core";

export interface DomainEventDefinition {
  version: number;
  publisher: DomainEventPublisher;
  payload: z.ZodType<unknown>;
}

/** Конец связи в payload: только тип и id, без названий и тел сущностей. */
export const entityLinkEndpointPayloadSchema = z
  .object({ type: searchableEntityTypeSchema, id: z.string().min(1) })
  .strict();
export type EntityLinkEndpointPayload = z.infer<typeof entityLinkEndpointPayloadSchema>;

/** Payload `entity_link.created/deleted`: тип связи и оба конца (Foundation Core, task 01). */
export const entityLinkChangedPayloadSchema = z
  .object({
    type: relationKindSchema,
    from: entityLinkEndpointPayloadSchema,
    to: entityLinkEndpointPayloadSchema
  })
  .strict();
export type EntityLinkChangedPayload = z.infer<typeof entityLinkChangedPayloadSchema>;

/**
 * Смена состояния проверки материала базы знаний (задание 06, п. 6.1). Публикуется в той же транзакции, что и
 * запись: подтверждение (`verify`) и сброс в `unverified` после правки содержимого. Тело материала не передаётся.
 */
export const knowledgeVerificationChangedPayloadSchema = z
  .object({
    id: z.string().min(1),
    from: z.enum(["unverified", "verified", "outdated"]),
    to: z.enum(["unverified", "verified", "outdated"])
  })
  .strict();
export type KnowledgeVerificationChangedPayload = z.infer<typeof knowledgeVerificationChangedPayloadSchema>;

/**
 * Задание 04: тайм-блок сдвинут (перенос окна, в том числе между днями).
 * В payload — только окно, ссылка на задачу и оценка «что затронуто»: id
 * зависимых задач и блоков, без их названий и без самих дат (получатель при
 * необходимости перечитает через публичные контракты).
 */
export const planningBlockMovedPayloadSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().nullable(),
    startAt: z.string(),
    endAt: z.string(),
    /** Сдвиг начала в минутах относительно прежнего окна; отрицательный — раньше. */
    shiftMinutes: z.number().int(),
    affectedTaskIds: z.array(z.string()),
    affectedBlockIds: z.array(z.string())
  })
  .strict();
export type PlanningBlockMovedPayload = z.infer<typeof planningBlockMovedPayloadSchema>;

/**
 * Задание 04: таймер переключён на другую задачу. Прежняя запись уже закрыта в
 * той же транзакции; событие нужно, чтобы подписчики (аналитика, журнал задач)
 * не догадывались об этом по разнице `endedAt`.
 */
export const timeEntrySwitchedPayloadSchema = z
  .object({
    /** Новая запущенная запись. */
    id: z.string().min(1),
    taskId: z.string().nullable(),
    projectId: z.string().nullable(),
    /** Закрытая запись или null, если до переключения таймер не шёл. */
    previousId: z.string().nullable()
  })
  .strict();
export type TimeEntrySwitchedPayload = z.infer<typeof timeEntrySwitchedPayloadSchema>;

/** Задание 04: запись времени исправлена вручную (`editedAt` + журнал правок в самой записи). */
export const timeEntryEditedPayloadSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().nullable(),
    /** Изменённые поля — имена колонок, не значения (значения могут быть личными). */
    fields: z.array(z.string()).min(1)
  })
  .strict();
export type TimeEntryEditedPayload = z.infer<typeof timeEntryEditedPayloadSchema>;

/**
 * Задание 10.1: строка пользовательской таблицы создана, изменена или удалена.
 * Payload — только id и действие: значения ячеек могут быть личными, подписчик
 * перечитает их через API таблиц.
 */
export const tableRowChangedPayloadSchema = z
  .object({
    tableId: z.string().min(1),
    rowId: z.string().min(1),
    action: z.enum(["created", "updated", "deleted"])
  })
  .strict();
export type TableRowChangedPayload = z.infer<typeof tableRowChangedPayloadSchema>;

export const DOMAIN_EVENT_CATALOG = {
  "tasks.task.changed": { version: 1, publisher: "tasks", payload: z.object({ id: z.string().min(1) }).strict() },
  "tasks.task.closed": { version: 1, publisher: "tasks", payload: tasksTaskClosedPayloadSchema },
  "tasks.task.updated": { version: 1, publisher: "tasks", payload: z.object({ id: z.string().min(1) }).strict() },
  "tasks.task.status_changed": { version: 1, publisher: "tasks", payload: tasksTaskStatusChangedPayloadSchema },
  "tasks.task.bulk_applied": { version: 1, publisher: "tasks", payload: tasksTaskBulkAppliedPayloadSchema },
  "tasks.recurrence.instance_completed": { version: 1, publisher: "tasks", payload: tasksRecurrenceInstanceCompletedPayloadSchema },
  "tasks.recurrence.skipped": { version: 1, publisher: "tasks", payload: tasksRecurrenceSkippedPayloadSchema },
  "tasks.task.assigned": { version: 1, publisher: "tasks", payload: tasksTaskAssignedPayloadSchema },
  "projects.project.status_changed": { version: 1, publisher: "projects", payload: projectsProjectStatusChangedPayloadSchema },
  "projects.project.dates_changed": { version: 1, publisher: "projects", payload: projectsProjectDatesChangedPayloadSchema },
  "projects.milestone.completed": { version: 1, publisher: "projects", payload: projectsMilestoneCompletedPayloadSchema },
  "projects.milestone.dates_changed": { version: 1, publisher: "projects", payload: projectsMilestoneDatesChangedPayloadSchema },
  "projects.project.updated": { version: 1, publisher: "projects", payload: projectsProjectUpdatedPayloadSchema },
  "projects.project.parent_changed": { version: 1, publisher: "projects", payload: projectsProjectParentChangedPayloadSchema },
  "knowledge.item.verification.changed": { version: 1, publisher: "knowledge", payload: knowledgeVerificationChangedPayloadSchema },
  "planning.block.moved": { version: 1, publisher: "planning", payload: planningBlockMovedPayloadSchema },
  "time.entry.switched": { version: 1, publisher: "time", payload: timeEntrySwitchedPayloadSchema },
  "time.entry.edited": { version: 1, publisher: "time", payload: timeEntryEditedPayloadSchema },
  "entity_link.created": { version: 1, publisher: "core", payload: entityLinkChangedPayloadSchema },
  "entity_link.deleted": { version: 1, publisher: "core", payload: entityLinkChangedPayloadSchema },
  // Общие инструменты (задание 10) — поверхность ядра, отдельного модуля в каталоге нет.
  "table.row_changed": { version: 1, publisher: "core", payload: tableRowChangedPayloadSchema }
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
  { id: "tasks.notify-assignee-on-close", componentId: "tasks", types: ["tasks.task.closed"] },
  {
    id: "projects.logbook-auto-entries",
    componentId: "projects-logbook",
    types: [
      "projects.project.status_changed",
      "projects.project.dates_changed",
      "projects.milestone.completed",
      "projects.milestone.dates_changed",
      "tasks.task.assigned"
    ]
  }
] as const satisfies readonly DomainEventSubscription[];

export function domainEventTypesSubscribedBy(componentId: string): string[] {
  const types = new Set<string>();
  for (const sub of DOMAIN_EVENT_SUBSCRIPTIONS) if (sub.componentId === componentId) sub.types.forEach((t) => types.add(t));
  return [...types];
}


/**
 * Диагностика outbox (Foundation Core, task 01.2): агрегаты по доставкам и самые старые
 * необработанные события. Только счётчики/идентификаторы и текст ошибки — без payload.
 */
export const domainEventDeliveryDiagnosticSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  type: z.string(),
  subscriberId: z.string(),
  status: z.enum(["pending", "done", "skipped_disabled", "failed"]),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string(),
  completedAt: z.string().nullable()
});
export type DomainEventDeliveryDiagnostic = z.infer<typeof domainEventDeliveryDiagnosticSchema>;

export const domainEventOutboxStatusSchema = z.object({
  pending: z.number().int(),
  done: z.number().int(),
  skippedDisabled: z.number().int(),
  failed: z.number().int(),
  /** Возраст самого старого события, ещё не разложенного по доставкам; null — очередь пуста. */
  oldestUndispatchedAgeSeconds: z.number().int().nullable(),
  /** Возраст самой старой ожидающей доставки; null — ожидающих нет. */
  oldestPendingAgeSeconds: z.number().int().nullable(),
  undeliveredByType: z.array(z.object({ type: z.string(), count: z.number().int() })),
  failedDeliveries: z.array(domainEventDeliveryDiagnosticSchema)
});
export type DomainEventOutboxStatus = z.infer<typeof domainEventOutboxStatusSchema>;
