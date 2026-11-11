import { z } from "zod";

/**
 * Tasks 2.0 (задание 02): плановые свойства, рекуррентность, массовые операции,
 * пользовательские поля и статусы.
 *
 * Здесь только контракты и чистые помощники — без Prisma и React. Логика сдвига
 * дат и проверки значений живёт тут, чтобы её покрывал `pnpm test` и чтобы
 * сервер и клиент не расходились в трактовке правил.
 */

// --- Плановые свойства (2.4) ------------------------------------------------

/** Сложность задачи — отдельная от `priority` оценка «насколько тяжело». */
export const taskComplexitySchema = z.enum(["low", "medium", "high"]);
export type TaskComplexity = z.infer<typeof taskComplexitySchema>;

/** Уровень важности/срочности для матрицы Эйзенхауэра (0 = не задан … 3 = максимальный). */
export const TASK_PLANNER_MAX_LEVEL = 3;
export const taskPlannerLevelSchema = z.number().int().min(0).max(TASK_PLANNER_MAX_LEVEL);

/**
 * Источник исполнения для аналитики: человек или ИИ-агент. `none` — исполнитель
 * не назначен. Поле хранится, а не выводится на лету: назначение агента живёт
 * в Agent Hub, и Tasks не читает его таблицы (только публичный реестр-guard).
 */
export const taskExecutorSourceSchema = z.enum(["none", "human", "agent"]);
export type TaskExecutorSource = z.infer<typeof taskExecutorSourceSchema>;

// --- Пользовательские статусы (2.3) ----------------------------------------

/**
 * Категория статуса — то, что важно семантике: закрыта ли задача, идёт ли работа.
 * Имя, цвет и порядок — оформление; `category` — контракт для отчётов и
 * `isTaskClosed`-подобных решений.
 */
export const taskStatusCategorySchema = z.enum(["open", "in_progress", "done", "cancelled"]);
export type TaskStatusCategory = z.infer<typeof taskStatusCategorySchema>;

export const taskStatusDefinitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  category: taskStatusCategorySchema,
  /** Цвет-метка строкой (не UI-компонент): палитра выбирается клиентом. */
  color: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  /** Для встроенных статусов — значение прежнего enum `TaskStatus`; у пользовательских null. */
  systemKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TaskStatusDefinition = z.infer<typeof taskStatusDefinitionSchema>;

export const createTaskStatusInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(60),
  category: taskStatusCategorySchema,
  color: z.string().trim().min(1).max(40).default("slate"),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional()
});
export type CreateTaskStatusInput = z.infer<typeof createTaskStatusInputSchema>;

export const updateTaskStatusInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    category: taskStatusCategorySchema.optional(),
    color: z.string().trim().min(1).max(40).optional(),
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Нет изменений");
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusInputSchema>;

/** Тело ответа 409 при удалении занятого статуса: клиент показывает перенос и просит подтверждение. */
export const taskStatusInUseSchema = z.object({
  code: z.literal("task_status_in_use"),
  statusId: z.string(),
  taskCount: z.number().int(),
  reassignToId: z.string()
});
export type TaskStatusInUse = z.infer<typeof taskStatusInUseSchema>;

// --- Пользовательские поля (2.3) -------------------------------------------

export const taskFieldTypeSchema = z.enum(["text", "number", "date", "select", "multi", "checkbox", "url"]);
export type TaskFieldType = z.infer<typeof taskFieldTypeSchema>;

export const taskFieldApplicabilitySchema = z.enum(["all", "project"]);
export type TaskFieldApplicability = z.infer<typeof taskFieldApplicabilitySchema>;

export const TASK_FIELD_OPTIONS_LIMIT = 100;

export const taskFieldDefinitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  type: taskFieldTypeSchema,
  /** Варианты для select/multi; для остальных типов — пустой массив. */
  options: z.array(z.string()),
  required: z.boolean(),
  applicability: taskFieldApplicabilitySchema,
  /** `applicability = project` — к какому проекту относится поле; иначе null. */
  projectId: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TaskFieldDefinition = z.infer<typeof taskFieldDefinitionSchema>;

const fieldOptionsSchema = z.array(z.string().trim().min(1).max(120)).max(TASK_FIELD_OPTIONS_LIMIT).default([]);

export const createTaskFieldInputSchema = z
  .object({
    name: z.string().trim().min(1, "Название обязательно").max(80),
    type: taskFieldTypeSchema,
    options: fieldOptionsSchema,
    required: z.boolean().default(false),
    applicability: taskFieldApplicabilitySchema.default("all"),
    projectId: z.string().nullable().optional(),
    sortOrder: z.number().int().optional()
  })
  .refine((value) => value.applicability === "all" || Boolean(value.projectId), {
    message: "Для поля проекта укажите projectId",
    path: ["projectId"]
  })
  .refine((value) => value.applicability === "project" || value.projectId == null, {
    message: "projectId допустим только для поля проекта",
    path: ["projectId"]
  })
  .refine((value) => (value.type !== "select" && value.type !== "multi") || value.options.length > 0, {
    message: "Для списка выбора нужны варианты",
    path: ["options"]
  });
export type CreateTaskFieldInput = z.infer<typeof createTaskFieldInputSchema>;

export const updateTaskFieldInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    type: taskFieldTypeSchema.optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(TASK_FIELD_OPTIONS_LIMIT).optional(),
    required: z.boolean().optional(),
    applicability: taskFieldApplicabilitySchema.optional(),
    projectId: z.string().nullable().optional(),
    sortOrder: z.number().int().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Нет изменений");
export type UpdateTaskFieldInput = z.infer<typeof updateTaskFieldInputSchema>;

/** Значение одного пользовательского поля: тип определяется определением поля. */
export const taskFieldValueScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type TaskFieldValueScalar = z.infer<typeof taskFieldValueScalarSchema>;

export const taskFieldValueInputSchema = z.object({
  fieldId: z.string().min(1),
  value: taskFieldValueScalarSchema.nullable()
});
export type TaskFieldValueInput = z.infer<typeof taskFieldValueInputSchema>;

export const setTaskFieldValuesInputSchema = z.object({
  values: z.array(taskFieldValueInputSchema).max(200)
});
export type SetTaskFieldValuesInput = z.infer<typeof setTaskFieldValuesInputSchema>;

export const taskFieldValueSchema = z.object({
  fieldId: z.string(),
  value: taskFieldValueScalarSchema.nullable()
});
export type TaskFieldValue = z.infer<typeof taskFieldValueSchema>;

/** Карта значений задачи: `fieldId → значение`. */
export const taskFieldValueMapSchema = z.record(z.string(), taskFieldValueScalarSchema.nullable());
export type TaskFieldValueMap = z.infer<typeof taskFieldValueMapSchema>;

/** Нормализованное текстовое представление значения — по нему строится поиск. */
export function taskFieldValueText(type: TaskFieldType, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (type === "multi") return Array.isArray(value) ? value.map(String).join(" ") : null;
  if (type === "checkbox") return value === true ? "да" : value === false ? "нет" : null;
  if (type === "number") return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return value.trim() || null;
  return null;
}

export type TaskFieldValidation =
  | { ok: true; value: string | number | boolean | string[] | null; text: string | null }
  | { ok: false; message: string };

/**
 * Проверка значения против определения поля. Пустая строка/null/[] трактуются
 * как «значения нет»; обязательность проверяет вызывающий (create/update),
 * потому что у существующей задачи поле могло появиться позже.
 */
export function validateTaskFieldValue(
  field: Pick<TaskFieldDefinition, "type" | "options" | "name">,
  raw: unknown
): TaskFieldValidation {
  const empty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (empty) return { ok: true, value: null, text: null };

  switch (field.type) {
    case "text":
      return typeof raw === "string" ? { ok: true, value: raw.trim(), text: raw.trim() || null } : { ok: false, message: `Поле «${field.name}»: ожидается текст` };
    case "url": {
      if (typeof raw !== "string") return { ok: false, message: `Поле «${field.name}»: ожидается ссылка` };
      const parsed = z.string().url().safeParse(raw.trim());
      if (!parsed.success) return { ok: false, message: `Поле «${field.name}»: некорректная ссылка` };
      return { ok: true, value: parsed.data, text: parsed.data };
    }
    case "date": {
      if (typeof raw !== "string") return { ok: false, message: `Поле «${field.name}»: ожидается дата` };
      const parsed = z.string().datetime().safeParse(raw);
      if (!parsed.success) return { ok: false, message: `Поле «${field.name}»: дата должна быть ISO-строкой` };
      return { ok: true, value: parsed.data, text: parsed.data };
    }
    case "number": {
      const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(value)) return { ok: false, message: `Поле «${field.name}»: ожидается число` };
      return { ok: true, value, text: taskFieldValueText(field.type, value) };
    }
    case "checkbox":
      return typeof raw === "boolean" ? { ok: true, value: raw, text: taskFieldValueText(field.type, raw) } : { ok: false, message: `Поле «${field.name}»: ожидается да/нет` };
    case "select": {
      if (typeof raw !== "string") return { ok: false, message: `Поле «${field.name}»: ожидается вариант из списка` };
      if (!field.options.includes(raw)) return { ok: false, message: `Поле «${field.name}»: нет варианта «${raw}»` };
      return { ok: true, value: raw, text: raw };
    }
    case "multi": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
        return { ok: false, message: `Поле «${field.name}»: ожидается список вариантов` };
      }
      const unknown = raw.find((item) => !field.options.includes(item));
      if (unknown !== undefined) return { ok: false, message: `Поле «${field.name}»: нет варианта «${unknown}»` };
      const deduped = [...new Set(raw)];
      return { ok: true, value: deduped, text: taskFieldValueText(field.type, deduped) };
    }
  }
}

// --- Рекуррентные задачи (2.1) ---------------------------------------------

/**
 * Подмножество правил повторения: без полного RRULE. `weekdays` — будни
 * (пн–пт); `weekly` может нести явный список дней недели (0 = понедельник).
 */
export const taskRecurrenceFreqSchema = z.enum(["daily", "weekly", "monthly", "weekdays"]);
export type TaskRecurrenceFrequency = z.infer<typeof taskRecurrenceFreqSchema>;

export const taskRecurrenceIntervalSchema = z.number().int().min(1).max(365);
export const taskRecurrenceWeekdaySchema = z.number().int().min(0).max(6);

export const taskRecurrenceEndSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("never") }),
  z.object({ mode: z.literal("count"), count: z.number().int().min(1).max(999) }),
  z.object({ mode: z.literal("until"), until: z.string().datetime() })
]);
export type TaskRecurrenceEnd = z.infer<typeof taskRecurrenceEndSchema>;

export const TASK_RECURRENCE_MAX_INSTANCES = 999;

/** Вход установки правила на задаче-шаблоне. */
export const setTaskRecurrenceInputSchema = z.object({
  freq: taskRecurrenceFreqSchema,
  interval: taskRecurrenceIntervalSchema.default(1),
  weekdays: z.array(taskRecurrenceWeekdaySchema).max(7).optional(),
  ends: taskRecurrenceEndSchema.default({ mode: "never" })
});
export type SetTaskRecurrenceInput = z.infer<typeof setTaskRecurrenceInputSchema>;

export const taskRecurrenceInstanceStatusSchema = z.enum(["scheduled", "completed", "skipped"]);
export type TaskRecurrenceInstanceStatus = z.infer<typeof taskRecurrenceInstanceStatusSchema>;

export const taskRecurrenceInstanceSchema = z.object({
  id: z.string(),
  recurrenceId: z.string(),
  taskId: z.string().nullable(),
  ordinal: z.number().int(),
  scheduledFor: z.string(),
  status: taskRecurrenceInstanceStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TaskRecurrenceInstance = z.infer<typeof taskRecurrenceInstanceSchema>;

export const taskRecurrenceRuleSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  templateId: z.string(),
  freq: taskRecurrenceFreqSchema,
  interval: z.number().int(),
  weekdays: z.array(taskRecurrenceWeekdaySchema),
  ends: taskRecurrenceEndSchema,
  /** Сколько экземпляров уже порождено, включая шаблон. */
  generatedCount: z.number().int(),
  /** Опора сетки (дата первого экземпляра) — по ней считаются «чётные» недели. */
  anchorAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  instances: z.array(taskRecurrenceInstanceSchema)
});
export type TaskRecurrenceRule = z.infer<typeof taskRecurrenceRuleSchema>;

/** Человекочитаемая сводка правила для карточки/формы. */
export function describeTaskRecurrence(rule: Pick<TaskRecurrenceRule, "freq" | "interval" | "weekdays" | "ends">): string {
  const n = Math.max(1, Math.floor(rule.interval));
  let base: string;
  if (rule.freq === "daily") base = n === 1 ? "ежедневно" : `каждые ${n} дн.`;
  else if (rule.freq === "weekdays") base = "по будням";
  else if (rule.freq === "weekly") {
    base = n === 1 ? "еженедельно" : `каждые ${n} нед.`;
    if (rule.weekdays.length) base += ` по ${rule.weekdays.map((day) => WEEKDAY_SHORT_RU[day]).join(", ")}`;
  } else base = n === 1 ? "ежемесячно" : `каждые ${n} мес.`;
  if (rule.ends.mode === "count") return `${base}, ${rule.ends.count} раз`;
  if (rule.ends.mode === "until") return `${base}, до ${new Date(rule.ends.until).toLocaleDateString("ru-RU")}`;
  return base;
}

export const WEEKDAY_SHORT_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function addUtcDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/** Понедельник 00:00 UTC недели, содержащей `date`. */
function mondayOf(date: Date): Date {
  const weekday = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - weekday * DAY_MS);
}

/** Сдвиг на месяцы с прижатием дня к длине месяца (31 января → 28/29 февраля). */
function addUtcMonths(base: Date, months: number): Date {
  const total = base.getUTCMonth() + months;
  const year = base.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(base.getUTCDate(), daysInMonth),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
}

function isBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * Следующая дата после `from` по правилу. `anchor` — дата первого экземпляра:
 * по ней сетка «каждые N недель» не съезжает после переноса отдельного
 * экземпляра (перенос меняет `from`, но не опору).
 */
export function advanceTaskRecurrence(
  from: Date,
  rule: Pick<TaskRecurrenceRule, "freq" | "interval" | "weekdays">,
  anchor: Date
): Date {
  const interval = Math.max(1, Math.floor(rule.interval));
  if (rule.freq === "daily") return addUtcDays(from, interval);
  if (rule.freq === "monthly") return addUtcMonths(from, interval);
  if (rule.freq === "weekdays") {
    let next = from;
    for (let step = 0; step < interval; step++) {
      next = addUtcDays(next, 1);
      while (!isBusinessDay(next)) next = addUtcDays(next, 1);
    }
    return next;
  }

  // weekly
  const weekdays = [...new Set(rule.weekdays)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (!weekdays.length) return addUtcDays(from, interval * 7);
  const anchorMonday = mondayOf(anchor).getTime();
  let candidate = addUtcDays(from, 1);
  // Горизонт с запасом: не больше двух полных циклов интервала.
  for (let guard = 0; guard < interval * 14 + 14; guard++) {
    const weekday = (candidate.getUTCDay() + 6) % 7;
    const weekIndex = Math.round((mondayOf(candidate).getTime() - anchorMonday) / (7 * DAY_MS));
    if (weekIndex >= 0 && weekIndex % interval === 0 && weekdays.includes(weekday)) return candidate;
    candidate = addUtcDays(candidate, 1);
  }
  return addUtcDays(from, interval * 7);
}

/** Достигнут ли конец серии к моменту следующего экземпляра. */
export function taskRecurrenceEndReached(
  ends: TaskRecurrenceEnd,
  generatedCount: number,
  nextDueAt: Date
): boolean {
  if (ends.mode === "count") return generatedCount >= ends.count;
  if (ends.mode === "until") return nextDueAt.getTime() > new Date(ends.until).getTime();
  return false;
}

// --- Массовые операции (2.2) ------------------------------------------------

/** Предел размера пачки — защита от «выделил всё». */
export const BULK_TASK_LIMIT = 200;

export const bulkTaskOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("complete") }),
  z.object({ type: z.literal("set-status"), status: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]).optional(), statusId: z.string().optional() }),
  z.object({ type: z.literal("set-priority"), priority: z.enum(["low", "normal", "high"]) }),
  z.object({ type: z.literal("move-to-project"), projectId: z.string().nullable() }),
  z.object({ type: z.literal("delete") }),
  z.object({ type: z.literal("archive"), archived: z.boolean().default(true) }),
  z.object({
    type: z.literal("change-dates"),
    dueAt: z.string().datetime().nullable().optional(),
    startAt: z.string().datetime().nullable().optional()
  })
]);
export type BulkTaskOperation = z.infer<typeof bulkTaskOperationSchema>;

export const bulkTaskRequestSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, "Выберите задачи").max(BULK_TASK_LIMIT, `Не больше ${BULK_TASK_LIMIT} задач за раз`),
  operation: bulkTaskOperationSchema,
  /** Предварительный ответ без изменений. `confirm: true` обязателен для применения. */
  dryRun: z.boolean().default(false),
  confirm: z.boolean().default(false),
  /** Разрешить применить успешные позиции, даже если часть отклонена. */
  allowPartial: z.boolean().default(false)
});
export type BulkTaskRequest = z.infer<typeof bulkTaskRequestSchema>;

export const BULK_TASK_ITEM_REASONS = ["not_found", "in_publication", "blocked", "no_permission", "archived", "invalid"] as const;
export const bulkTaskItemReasonSchema = z.enum(BULK_TASK_ITEM_REASONS);
export type BulkTaskItemReason = z.infer<typeof bulkTaskItemReasonSchema>;

export const bulkTaskItemResultSchema = z.object({
  taskId: z.string(),
  ok: z.boolean(),
  reason: bulkTaskItemReasonSchema.nullable(),
  message: z.string().nullable()
});
export type BulkTaskItemResult = z.infer<typeof bulkTaskItemResultSchema>;

export const bulkTaskEffectsSchema = z.object({
  completed: z.number().int(),
  statusChanged: z.number().int(),
  priorityChanged: z.number().int(),
  moved: z.number().int(),
  deleted: z.number().int(),
  archived: z.number().int(),
  datesChanged: z.number().int()
});
export type BulkTaskEffects = z.infer<typeof bulkTaskEffectsSchema>;

export const bulkTaskResultSchema = z.object({
  /** true — изменения не применялись (dry-run либо нет `confirm`). */
  dryRun: z.boolean(),
  applied: z.boolean(),
  items: z.array(bulkTaskItemResultSchema),
  summary: z.object({
    requested: z.number().int(),
    ok: z.number().int(),
    failed: z.number().int()
  }),
  effects: bulkTaskEffectsSchema
});
export type BulkTaskResult = z.infer<typeof bulkTaskResultSchema>;

export function emptyBulkTaskEffects(): BulkTaskEffects {
  return { completed: 0, statusChanged: 0, priorityChanged: 0, moved: 0, deleted: 0, archived: 0, datesChanged: 0 };
}
