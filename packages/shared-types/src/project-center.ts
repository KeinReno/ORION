import { z, type ZodTypeDef } from "zod";
import { projectStatusSchema, type ProjectStatus } from "./project";
import { taskPrioritySchema } from "./task";

/**
 * Задание 03 «Центр проектов»: иерархия, шаблоны, портфель и история изменений.
 *
 * Здесь живёт только контракт и чистые помощники (общие для сервера и тестов):
 * вычисление дат из сдвигов шаблона, путь цикла в иерархии, риски портфеля.
 * Серверная логика (транзакции, RLS, дерево) — в `apps/api/src/projects/`.
 */

/** Максимальная глубина дерева проектов (корень = 1). Ограничение — осознанное: глубже нечитаемо и дороже по CTE. */
export const PROJECT_TREE_MAX_DEPTH = 6;

/** Поля проекта, изменения которых попадают в audit trail (`GET projects/:id/history`). */
export const PROJECT_HISTORY_FIELDS = [
  "name",
  "description",
  "status",
  "color",
  "startAt",
  "dueAt",
  "budgetAmount",
  "hourlyRate",
  "currency",
  "contextNote",
  "parentId",
  "archivedAt"
] as const;
export type ProjectHistoryField = (typeof PROJECT_HISTORY_FIELDS)[number];

/** Одно изменение поля: «было → стало» в строковом виде (даты — ISO, числа — как есть). */
export interface ProjectFieldChange {
  field: ProjectHistoryField;
  from: string | null;
  to: string | null;
}

/**
 * Значение поля проекта → строка истории. Приведение одно на сервер и тесты:
 * `null`/`undefined` — это «пусто», `Date` — ISO, остальное — как есть. Иначе
 * «не задано» и «пустая строка» могли бы выглядеть в истории одинаково.
 */
export function projectHistoryValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/**
 * Что именно изменилось между текущей строкой и патчем — та же логика, что
 * пишет audit trail. Поля патча, которых нет в `PROJECT_HISTORY_FIELDS`, не
 * попадают в историю (например `sharedOrder` — это порядок доски, а не
 * свойство проекта). Ноль изменений → пустой массив: «сохранено» без правки
 * не создаёт запись.
 */
export function projectFieldChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  fields: readonly ProjectHistoryField[] = PROJECT_HISTORY_FIELDS
): ProjectFieldChange[] {
  const changes: ProjectFieldChange[] = [];
  for (const field of fields) {
    if (!(field in patch) || patch[field] === undefined) continue;
    const from = projectHistoryValue(before[field]);
    const to = projectHistoryValue(patch[field]);
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

/** Запись audit trail: одно изменение одного поля проекта. */
export const projectHistoryEntrySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  /** null — системное изменение (без автора). */
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  field: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  /** Доменное событие, которым изменение объявлено наружу (трассировка шины). */
  eventId: z.string().nullable(),
  /** Запись журнала («решение»), к которой отнесено изменение. */
  logEntryId: z.string().nullable(),
  createdAt: z.string()
});
export type ProjectHistoryEntry = z.infer<typeof projectHistoryEntrySchema>;

export const projectHistoryPageSchema = z.object({
  items: z.array(projectHistoryEntrySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive()
});
export type ProjectHistoryPage = z.infer<typeof projectHistoryPageSchema>;

/** Query `GET projects/:id/history`: фильтры по полю и периоду + пагинация. */
export const projectHistoryQuerySchema = z
  .object({
    field: z.string().max(60).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).optional()
  })
  .strict();
export type ProjectHistoryQuery = z.infer<typeof projectHistoryQuerySchema>;

/** `POST projects/:id/history/:historyId/decision` — отнести изменение к записи журнала. */
export const linkProjectHistoryDecisionInputSchema = z
  .object({ entryId: z.string().uuid() })
  .strict();
export type LinkProjectHistoryDecisionInput = z.infer<typeof linkProjectHistoryDecisionInputSchema>;

// --- Шаблоны -------------------------------------------------------------------------------------

/** Задача шаблона: содержимое и сдвиги в днях от стартовой даты проекта. Исполнителей и абсолютных дат нет. */
export const projectTemplateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Название задачи обязательно").max(200),
    description: z.string().max(20_000).default(""),
    priority: taskPrioritySchema.default("normal"),
    /** Шаблон не создаёт завершённую работу: done/canceled в шаблоне запрещены. */
    status: z.enum(["backlog", "todo", "in_progress"]).default("todo"),
    estimateMinutes: z.number().int().min(0).max(1_000_000).nullable().default(null),
    startOffsetDays: z.number().int().min(-3650).max(3650).default(0),
    dueOffsetDays: z.number().int().min(-3650).max(3650).nullable().default(null),
    /** Индекс вехи в массиве `milestones` этого же шаблона; null — задача без вехи. */
    milestoneIndex: z.number().int().min(0).max(500).nullable().default(null)
  })
  .strict();
export type ProjectTemplateTask = z.infer<typeof projectTemplateTaskSchema>;

export const projectTemplateMilestoneSchema = z
  .object({
    title: z.string().trim().min(1, "Название вехи обязательно").max(200),
    note: z.string().max(4_000).default(""),
    status: z.enum(["planned", "in_progress", "done"]).default("planned"),
    startOffsetDays: z.number().int().min(-3650).max(3650).default(0),
    dueOffsetDays: z.number().int().min(-3650).max(3650).nullable().default(null),
    estimateMinutes: z.number().int().min(0).max(1_000_000).nullable().default(null)
  })
  .strict();
export type ProjectTemplateMilestone = z.infer<typeof projectTemplateMilestoneSchema>;

/** Запись журнала, которую шаблон создаёт сразу: тип + текст + сдвиг в днях. */
export const projectTemplateLogEntrySchema = z
  .object({
    kind: z.enum(["observation", "decision", "change", "hypothesis", "result", "incident"]),
    text: z.string().trim().min(1, "Текст записи обязателен").max(5_000),
    dayOffset: z.number().int().min(-3650).max(3650).default(0)
  })
  .strict();
export type ProjectTemplateLogEntry = z.infer<typeof projectTemplateLogEntrySchema>;

/**
 * Дочерний проект в шаблоне. Дерево вкладывается рекурсивно, но глубина
 * ограничена `PROJECT_TREE_MAX_DEPTH` — проверяется `projectTemplateDepth`.
 */
export interface ProjectTemplateNodeInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  color?: string | null;
  startOffsetDays?: number;
  dueOffsetDays?: number | null;
  milestones?: ProjectTemplateMilestone[];
  tasks?: ProjectTemplateTask[];
  logEntries?: ProjectTemplateLogEntry[];
  children?: ProjectTemplateNodeInput[];
}

/**
 * Рекурсивная схема. Вход объявлен как `unknown`: у вложенных полей есть
 * `.default(...)`, поэтому входной тип Zod шире выходного — нам важен выходной
 * (`ProjectTemplateNodeInput`), а вход всё равно проверяет сам парсер.
 */
export const projectTemplateNodeSchema: z.ZodType<ProjectTemplateNodeInput, ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      name: z.string().trim().min(1, "Название проекта обязательно").max(120),
      description: z.string().max(20_000).default(""),
      status: projectStatusSchema.default("active"),
      color: z.string().max(40).nullable().default(null),
      startOffsetDays: z.number().int().min(-3650).max(3650).default(0),
      dueOffsetDays: z.number().int().min(-3650).max(3650).nullable().default(null),
      milestones: z.array(projectTemplateMilestoneSchema).max(200).default([]),
      tasks: z.array(projectTemplateTaskSchema).max(500).default([]),
      logEntries: z.array(projectTemplateLogEntrySchema).max(100).default([]),
      children: z.array(projectTemplateNodeSchema).max(50).default([])
    })
    .strict()
);

/** Корень шаблона — собственно проект, который создаётся первым. */
export const projectTemplateStructureSchema = projectTemplateNodeSchema;
export type ProjectTemplateStructure = ProjectTemplateNodeInput;

export const projectTemplateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string(),
  structure: projectTemplateStructureSchema,
  createdById: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProjectTemplate = z.infer<typeof projectTemplateSchema>;

export const createProjectTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1, "Название шаблона обязательно").max(120),
    description: z.string().max(20_000).default(""),
    structure: projectTemplateStructureSchema
  })
  .strict();
export type CreateProjectTemplateInput = z.infer<typeof createProjectTemplateInputSchema>;

export const updateProjectTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(20_000).optional(),
    structure: projectTemplateStructureSchema.optional(),
    archivedAt: z.string().datetime().nullable().optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), "Нет изменений");
export type UpdateProjectTemplateInput = z.infer<typeof updateProjectTemplateInputSchema>;

/** `POST projects/from-template`: проект + вся структура в одной транзакции. */
export const createProjectFromTemplateInputSchema = z
  .object({
    templateId: z.string().uuid(),
    name: z.string().trim().min(1, "Название проекта обязательно").max(120),
    /** Стартовая дата, от которой отсчитываются сдвиги шаблона. По умолчанию — сегодня. */
    startDate: z.string().datetime().optional(),
    /** Родитель создаваемого проекта (дочерний проект в существующем дереве). */
    parentId: z.string().uuid().nullable().optional()
  })
  .strict();
export type CreateProjectFromTemplateInput = z.infer<typeof createProjectFromTemplateInputSchema>;

/** `POST projects/:id/duplicate`: копия структуры без исполнителей и содержимого задач по умолчанию. */
export const duplicateProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** Копировать описания/заметки (по умолчанию false — только структура). */
    withContent: z.boolean().default(false),
    /** Копировать дочерние проекты (по умолчанию true — структура дерева сохраняется). */
    withChildren: z.boolean().default(true),
    /** Стартовая дата копии; без неё даты остаются теми же (копия рядом с оригиналом). */
    startDate: z.string().datetime().optional()
  })
  .strict();
export type DuplicateProjectInput = z.infer<typeof duplicateProjectInputSchema>;

export const projectFromTemplateResultSchema = z.object({
  projectId: z.string(),
  created: z.object({
    projects: z.number().int().nonnegative(),
    milestones: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    logEntries: z.number().int().nonnegative()
  })
});
export type ProjectFromTemplateResult = z.infer<typeof projectFromTemplateResultSchema>;

/** Наибольшая глубина дерева шаблона (корень = 1). */
export function projectTemplateDepth(node: ProjectTemplateNodeInput): number {
  const children = node.children ?? [];
  return 1 + children.reduce((max, child) => Math.max(max, projectTemplateDepth(child)), 0);
}

/** Число проектов в дереве шаблона (корень включительно). */
export function projectTemplateNodeCount(node: ProjectTemplateNodeInput): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + projectTemplateNodeCount(child), 0);
}

/**
 * Смещение в днях от стартовой даты. `startDate` задаёт полночь UTC того дня:
 * проект «начинается такого-то числа», и часовой пояс пользователя не должен
 * сдвигать дату на сутки назад.
 */
export function offsetDate(startDate: Date, offsetDays: number): Date {
  return new Date(startDate.getTime() + offsetDays * 24 * 60 * 60 * 1000);
}

/** Полночь UTC от даты/ISO-строки — база для всех сдвигов шаблона. */
export function startOfUtcDay(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Цепочка цикла иерархии: `[projectId, ...путь от ребёнка к projectId]`, последний элемент — сам projectId. */
export function hierarchyCyclePath(projectId: string, ancestorIds: readonly string[]): string[] {
  return [...ancestorIds, projectId];
}

// --- Портфель -------------------------------------------------------------------------------------

export const PROJECT_PORTFOLIO_RISK_KINDS = [
  /** У проекта есть сроки, но ни одной задачи. */
  "no_tasks",
  /** Веха без даты. */
  "milestone_without_dates",
  /** Проект просрочен. */
  "overdue",
  /** Зависимость (`depends_on`) от проекта на паузе или архивного. */
  "blocked_dependency"
] as const;
export const projectPortfolioRiskKindSchema = z.enum(PROJECT_PORTFOLIO_RISK_KINDS);
export type ProjectPortfolioRiskKind = z.infer<typeof projectPortfolioRiskKindSchema>;

export const PROJECT_PORTFOLIO_RISK_LABEL: Record<ProjectPortfolioRiskKind, string> = {
  no_tasks: "Проект со сроками, но без задач",
  milestone_without_dates: "Веха без даты",
  overdue: "Просрочен",
  blocked_dependency: "Зависит от заблокированного проекта"
};

/** Уровень риска: high — просрочка/блокирующая зависимость, medium — веха без даты, low — прочее. */
export const projectPortfolioRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type ProjectPortfolioRiskLevel = z.infer<typeof projectPortfolioRiskLevelSchema>;

export const projectPortfolioRiskLevelOf = (kind: ProjectPortfolioRiskKind): ProjectPortfolioRiskLevel =>
  kind === "overdue" || kind === "blocked_dependency" ? "high" : kind === "milestone_without_dates" ? "medium" : "low";

export const projectPortfolioRiskSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  kind: projectPortfolioRiskKindSchema,
  level: projectPortfolioRiskLevelSchema,
  /** Человеческая деталь: имя вехи, срок или связанный проект. */
  detail: z.string()
});
export type ProjectPortfolioRisk = z.infer<typeof projectPortfolioRiskSchema>;

export const projectPortfolioItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: projectStatusSchema,
  parentId: z.string().nullable(),
  archivedAt: z.string().nullable(),
  startAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  /** Доля закрытых задач в процентах (0–100) — та же арифметика, что в карточке проекта. */
  progress: z.number().min(0).max(100),
  tasks: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  overdue: z.boolean(),
  /** Уровень риска проекта: максимальный среди его рисков; null — рисков нет. */
  riskLevel: projectPortfolioRiskLevelSchema.nullable()
});
export type ProjectPortfolioItem = z.infer<typeof projectPortfolioItemSchema>;

export const projectPortfolioDeadlineSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  dueAt: z.string(),
  /** Дней до дедлайна; отрицательное — просрочка. */
  daysLeft: z.number().int()
});
export type ProjectPortfolioDeadline = z.infer<typeof projectPortfolioDeadlineSchema>;

export const projectPortfolioWorkloadSchema = z.object({
  memberId: z.string(),
  /** Имя участника; null — исполнитель, которого уже нет в пространстве. */
  name: z.string().nullable(),
  openTasks: z.number().int().nonnegative()
});
export type ProjectPortfolioWorkload = z.infer<typeof projectPortfolioWorkloadSchema>;

export const projectPortfolioSchema = z.object({
  generatedAt: z.string(),
  totals: z.object({
    projects: z.number().int().nonnegative(),
    byStatus: z.array(z.object({ status: projectStatusSchema, count: z.number().int().nonnegative() })),
    tasks: z.number().int().nonnegative(),
    openTasks: z.number().int().nonnegative(),
    overdueProjects: z.number().int().nonnegative(),
    /** Проектов с риском (riskLevel != null). */
    projectsAtRisk: z.number().int().nonnegative()
  }),
  items: z.array(projectPortfolioItemSchema),
  /** Пагинация items: всего подходящих проектов и признак усечения агрегатов. */
  page: z.object({
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    truncated: z.boolean()
  }),
  deadlines: z.array(projectPortfolioDeadlineSchema),
  risks: z.array(projectPortfolioRiskSchema),
  workload: z.array(projectPortfolioWorkloadSchema)
});
export type ProjectPortfolio = z.infer<typeof projectPortfolioSchema>;

export const PROJECT_PORTFOLIO_MAX_LIMIT = 200;
export const PROJECT_PORTFOLIO_DEFAULT_LIMIT = 50;

/** Query `GET projects/portfolio`. */
export const projectPortfolioQuerySchema = z
  .object({
    /** `active` (по умолчанию) | `archived` | `all`. */
    scope: z.enum(["active", "archived", "all"]).optional(),
    status: projectStatusSchema.optional(),
    /** WorkspaceMember.id участника — у кого есть открытые задачи в проектах портфеля. */
    memberId: z.string().optional(),
    /** Дата-окно по `dueAt`: с (включительно). */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(PROJECT_PORTFOLIO_MAX_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).optional()
  })
  .strict();
export type ProjectPortfolioQuery = z.infer<typeof projectPortfolioQuerySchema>;

/**
 * Дней до дедлайна от «сейчас» по календарным суткам UTC (не по часам):
 * «срок завтра» — это 1, а не «через 5 часов». Отрицательное — просрочка.
 */
export function deadlineDaysLeft(dueAt: Date | string, now: Date = new Date()): number {
  const due = startOfUtcDay(dueAt).getTime();
  const today = startOfUtcDay(now).getTime();
  return Math.round((due - today) / (24 * 60 * 60 * 1000));
}

/**
 * Риски одного проекта — чистая функция: имена, даты и связи приходят снаружи
 * (вехи/зависимости читают владельцы), здесь только правила.
 */
export function projectRiskKinds(input: {
  hasTasks: boolean;
  hasDates: boolean;
  overdue: boolean;
  milestoneWithoutDates: readonly string[];
  blockedDependencies: readonly string[];
}): Array<{ kind: ProjectPortfolioRiskKind; detail: string }> {
  const risks: Array<{ kind: ProjectPortfolioRiskKind; detail: string }> = [];
  if (!input.hasTasks && input.hasDates) risks.push({ kind: "no_tasks", detail: "Ни одной задачи при заданных сроках" });
  for (const title of input.milestoneWithoutDates) risks.push({ kind: "milestone_without_dates", detail: title });
  if (input.overdue) risks.push({ kind: "overdue", detail: "Срок прошёл, проект не завершён" });
  for (const name of input.blockedDependencies) risks.push({ kind: "blocked_dependency", detail: name });
  return risks;
}

/** Максимальный уровень среди рисков; null для пустого списка. */
export function highestRiskLevel(kinds: readonly ProjectPortfolioRiskKind[]): ProjectPortfolioRiskLevel | null {
  const rank: Record<ProjectPortfolioRiskLevel, number> = { low: 0, medium: 1, high: 2 };
  let best: ProjectPortfolioRiskLevel | null = null;
  for (const kind of kinds) {
    const level = projectPortfolioRiskLevelOf(kind);
    if (!best || rank[level] > rank[best]) best = level;
  }
  return best;
}
