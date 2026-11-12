import { z } from "zod";
import { entityLinkSchema } from "./search";

/**
 * Типы записей журнала проекта (задание 05). `kind` — историческое имя того же
 * поля: first slice имел только observation/decision/change. Новый контракт
 * отдаёт `type` и оставляет `kind` как алиас, чтобы открытые старые клиенты не
 * ломались (parity before redesign). Новые значения — hypothesis/result/incident.
 */
export const PROJECT_LOG_TYPES = ["observation", "decision", "hypothesis", "result", "incident", "change"] as const;
export const projectLogTypeSchema = z.enum(PROJECT_LOG_TYPES);
export type ProjectLogType = z.infer<typeof projectLogTypeSchema>;

/** @deprecated Историческое имя `ProjectLogType`; используйте `ProjectLogType`. */
export const PROJECT_LOG_KINDS = PROJECT_LOG_TYPES;
/** @deprecated Историческое имя `projectLogTypeSchema`; используйте `projectLogTypeSchema`. */
export const projectLogKindSchema = projectLogTypeSchema;
/** @deprecated Историческое имя `ProjectLogType`; используйте `ProjectLogType`. */
export type ProjectLogKind = ProjectLogType;

export const PROJECT_LOG_KIND_LABEL: Record<ProjectLogType, string> = {
  observation: "Наблюдение",
  decision: "Решение",
  hypothesis: "Гипотеза",
  result: "Результат",
  incident: "Инцидент",
  change: "Изменение"
};

export const PROJECT_LOG_SEVERITIES = ["low", "medium", "high"] as const;
export const projectLogSeveritySchema = z.enum(PROJECT_LOG_SEVERITIES);
export type ProjectLogSeverity = z.infer<typeof projectLogSeveritySchema>;
export const PROJECT_LOG_SEVERITY_LABEL: Record<ProjectLogSeverity, string> = {
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая"
};

/** Результат подтверждает или опровергает гипотезу/решение, на которое ссылается. */
export const PROJECT_LOG_VERDICTS = ["confirms", "refutes"] as const;
export const projectLogVerdictSchema = z.enum(PROJECT_LOG_VERDICTS);
export type ProjectLogVerdict = z.infer<typeof projectLogVerdictSchema>;
export const PROJECT_LOG_VERDICT_LABEL: Record<ProjectLogVerdict, string> = {
  confirms: "Подтверждает",
  refutes: "Опровергает"
};

/**
 * `manual` — запись создал человек (и может править, если он автор или
 * владелец/руководитель пространства). `event` — автозапись из domain events:
 * только чтение, удаляется вместе с проектом.
 */
export const PROJECT_LOG_SOURCES = ["manual", "event"] as const;
export const projectLogSourceSchema = z.enum(PROJECT_LOG_SOURCES);
export type ProjectLogSource = z.infer<typeof projectLogSourceSchema>;

export const projectLogAlternativeSchema = z.object({
  option: z.string().trim().min(1).max(500),
  whyNot: z.string().trim().max(1000)
}).strict();
export type ProjectLogAlternative = z.infer<typeof projectLogAlternativeSchema>;

/** Входная форма альтернативы: `whyNot` необязателен, сервис подставляет "". */
const projectLogAlternativeInputSchema = z.object({
  option: z.string().trim().min(1).max(500),
  whyNot: z.string().trim().max(1000).default("")
}).strict();

export const projectLogTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  comment: z.string(),
  url: z.string().nullable()
});
export type ProjectLogTask = z.infer<typeof projectLogTaskSchema>;

export const projectLogEntrySchema = z.object({
  id: z.string(), workspaceId: z.string(), projectId: z.string(),
  /** Новый контракт: тип записи. */
  type: projectLogTypeSchema,
  /** Старый алиас `type` — остаётся, пока его читает прежний клиент журнала. */
  kind: projectLogTypeSchema,
  text: z.string(), authorId: z.string(), authorName: z.string(), mine: z.boolean(),
  rationale: z.string(),
  alternatives: z.array(projectLogAlternativeSchema),
  verificationDue: z.string().nullable(),
  confirmsEntryId: z.string().nullable(),
  severity: projectLogSeveritySchema.nullable(),
  resolution: z.string(),
  verdict: projectLogVerdictSchema.nullable(),
  source: projectLogSourceSchema,
  sourceEventId: z.string().nullable(),
  sourceEventType: z.string().nullable(),
  /** Правка/удаление доступны только у ручной записи и только автору или менеджеру. */
  editable: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.array(projectLogTaskSchema)
});
export type ProjectLogEntry = z.infer<typeof projectLogEntrySchema>;

/**
 * Вход создания. `type` — новый контракт, `kind` — старый; сервис принимает
 * любой из них (ровно один не обязателен, если значения совпадают). Поля,
 * не относящиеся к выбранному типу, сервис отвергает 422 с картой ошибок.
 */
const createProjectLogEntryObjectSchema = z.object({
  type: projectLogTypeSchema.optional(),
  kind: projectLogTypeSchema.optional(),
  text: z.string().trim().min(1, "Добавьте запись").max(5000),
  rationale: z.string().trim().max(5000).default(""),
  alternatives: z.array(projectLogAlternativeInputSchema).max(20).default([]),
  verificationDue: z.string().datetime({ offset: true }).nullable().optional(),
  confirmsEntryId: z.string().uuid().nullable().optional(),
  severity: projectLogSeveritySchema.optional(),
  resolution: z.string().trim().max(2000).default(""),
  verdict: projectLogVerdictSchema.optional(),
  tasks: z.array(z.object({ taskId: z.string().uuid(), comment: z.string().trim().max(2000).default("") }).strict()).max(20).default([])
}).strict();

export const createProjectLogEntryInputSchema = createProjectLogEntryObjectSchema
  .refine((value) => value.type !== undefined || value.kind !== undefined, {
    message: "Укажите тип записи",
    path: ["type"]
  })
  .refine((value) => value.type === undefined || value.kind === undefined || value.type === value.kind, {
    message: "type и kind расходятся",
    path: ["type"]
  })
  .refine((value) => new Set(value.tasks.map((item) => item.taskId)).size === value.tasks.length, "Одна задача указана несколько раз");
export type CreateProjectLogEntryInput = z.input<typeof createProjectLogEntryInputSchema>;

/** Правка ручной записи. `type`/`kind` можно не передавать — тогда тип не меняется. */
export const updateProjectLogEntryInputSchema = z.object({
  type: projectLogTypeSchema.optional(),
  text: z.string().trim().min(1, "Текст записи не может быть пустым").max(5000).optional(),
  rationale: z.string().trim().max(5000).optional(),
  alternatives: z.array(projectLogAlternativeInputSchema).max(20).optional(),
  verificationDue: z.string().datetime({ offset: true }).nullable().optional(),
  confirmsEntryId: z.string().uuid().nullable().optional(),
  severity: projectLogSeveritySchema.nullable().optional(),
  resolution: z.string().trim().max(2000).optional(),
  verdict: projectLogVerdictSchema.nullable().optional()
}).strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Нет изменений");
export type UpdateProjectLogEntryInput = z.input<typeof updateProjectLogEntryInputSchema>;

/** Фильтры списка журнала (query string). `projectId` — только для workspace-wide endpoint. */
export const projectLogFiltersSchema = z.object({
  type: projectLogTypeSchema.optional(),
  authorId: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  projectId: z.string().uuid().optional(),
  /** "true" — только записи со связанными задачами, "false" — только без них. */
  hasTasks: z.enum(["true", "false"]).optional(),
  /** Включать дочерние проекты (recursive CTE по `Project.parentId`, когда иерархия появится). */
  includeChildren: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).strict();
export type ProjectLogFilters = z.infer<typeof projectLogFiltersSchema>;

export const PROJECT_LOG_SUMMARY_LIMIT = 50;

export const projectLogSummarySchema = z.object({
  projectId: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  counts: z.record(projectLogTypeSchema, z.number()),
  total: z.number(),
  overdueHypotheses: z.array(projectLogEntrySchema),
  incidentsWithoutResolution: z.array(projectLogEntrySchema),
  decisionsWithoutResults: z.array(projectLogEntrySchema)
});
export type ProjectLogSummary = z.infer<typeof projectLogSummarySchema>;

/** `GET /project-log/:entryId/related` — универсальные связи без дублирования в таблице записи. */
export const projectLogRelatedSchema = z.object({
  entryId: z.string(),
  links: z.array(entityLinkSchema)
});
export type ProjectLogRelated = z.infer<typeof projectLogRelatedSchema>;

export const PROJECT_RELATION_TYPES = ["continues", "replaces", "based_on", "depends_on", "related"] as const;
export const projectRelationTypeSchema = z.enum(PROJECT_RELATION_TYPES);
export type ProjectRelationType = z.infer<typeof projectRelationTypeSchema>;
export const PROJECT_RELATION_LABEL: Record<ProjectRelationType, string> = {
  continues: "Продолжает",
  replaces: "Заменяет",
  based_on: "Создан на основе",
  depends_on: "Зависит от",
  related: "Связан с"
};
export const projectRelationSchema = z.object({
  id: z.string(), type: projectRelationTypeSchema, fromProjectId: z.string(), toProjectId: z.string(),
  fromProjectName: z.string(), toProjectName: z.string(), createdAt: z.string(), mine: z.boolean()
});
export type ProjectRelation = z.infer<typeof projectRelationSchema>;
export const createProjectRelationInputSchema = z.object({
  type: projectRelationTypeSchema, toProjectId: z.string().uuid()
}).strict();
export type CreateProjectRelationInput = z.infer<typeof createProjectRelationInputSchema>;
