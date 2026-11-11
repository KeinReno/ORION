import { z } from "zod";
import { taskStatusSchema, type TaskPriority, type TaskStatus } from "./task";

/**
 * ORION «Планирование» (задание 04). Календарь планирования, Гантт, матрица и
 * план/факт времени — это ПРЕДСТАВЛЕНИЯ существующих задач, проектов, вех и
 * событий, а не новая предметная модель: здесь нет ни второй таблицы задач, ни
 * второго списка связей. Единственные собственные сущности — тайм-блоки
 * (`PlanningBlock`, окно фокуса/встречи), пресеты осей матрицы
 * (`PlanningMatrixPreset`) и недельный план времени (`TimePlan` в `time.ts`).
 *
 * Чистые расчёты (CPM, оценка последствий переноса, квадрант) живут здесь, а не
 * в API-сервисе: одна реализация для сервера и клиента — тот же приём, что
 * `habitStreak`/`entryMinutes`, — и их можно проверить без базы.
 */

// ---------------------------------------------------------------------------
// Оси матрицы
// ---------------------------------------------------------------------------

/**
 * `customFieldId` — ось на пользовательском поле задачи (`TaskFieldDefinition`,
 * задание 02). Пока таких полей нет, ось недоступна: API отвечает 409 с
 * объяснением, а не подставляет пустоту молча.
 */
export const PLANNING_AXIS_KINDS = ["importance", "urgency", "priority", "status", "customFieldId"] as const;
export const planningAxisKindSchema = z.enum(PLANNING_AXIS_KINDS);
export type PlanningAxisKind = z.infer<typeof planningAxisKindSchema>;

export const planningAxisSchema = z.object({
  /** Имя поля задачи. Для `customFieldId` — id определения поля из Task 2.0. */
  field: z.string().trim().min(1).max(120),
  kind: planningAxisKindSchema
});
export type PlanningAxis = z.infer<typeof planningAxisSchema>;

/** Значения осей приводятся к 0–3; «высокая» половина — 2 и больше. */
export const PLANNING_AXIS_HIGH_THRESHOLD = 2;
export const PLANNING_AXIS_MAX_VALUE = 3;

export const EISENHOWER_PRESET_ID = "eisenhower";
export const EISENHOWER_PRESET_NAME = "Эйзенхауэр";
/** x — важность, y — срочность (как подписана матрица). */
export const EISENHOWER_X_AXIS: PlanningAxis = { field: "importance", kind: "importance" };
export const EISENHOWER_Y_AXIS: PlanningAxis = { field: "urgency", kind: "urgency" };

export const MATRIX_QUADRANT_IDS = ["q1", "q2", "q3", "q4"] as const;
export const matrixQuadrantIdSchema = z.enum(MATRIX_QUADRANT_IDS);
export type MatrixQuadrantId = z.infer<typeof matrixQuadrantIdSchema>;

/**
 * Подписи намеренно описывают положение («важно и срочно»), а не действие
 * («сделать», «делегировать»): действие зависит от роли и контекста, а пара
 * координат — нет. Числа в id фиксированы: q1 — высокие обе оси.
 */
export const MATRIX_QUADRANT_LABELS: Record<MatrixQuadrantId, string> = {
  q1: "Важно и срочно",
  q2: "Важно, не срочно",
  q3: "Срочно, не важно",
  q4: "Не важно и не срочно"
};

/** Что означает ячейка по осям: `{ x: высокая?, y: высокая? }`. */
export function quadrantTargets(quadrant: MatrixQuadrantId): { x: boolean; y: boolean } {
  switch (quadrant) {
    case "q1":
      return { x: true, y: true };
    case "q2":
      return { x: true, y: false };
    case "q3":
      return { x: false, y: true };
    case "q4":
      return { x: false, y: false };
  }
}

export function quadrantFor(xHigh: boolean, yHigh: boolean): MatrixQuadrantId {
  if (xHigh && yHigh) return "q1";
  if (xHigh) return "q2";
  if (yHigh) return "q3";
  return "q4";
}

export const matrixPresetSchema = z.object({
  /** Встроенный пресет отвечает id `eisenhower` и не хранится в базе. */
  id: z.string(),
  workspaceId: z.string().nullable(),
  name: z.string(),
  builtIn: z.boolean(),
  xAxis: planningAxisSchema,
  yAxis: planningAxisSchema,
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});
export type MatrixPreset = z.infer<typeof matrixPresetSchema>;

export const createMatrixPresetInputSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(120),
  xAxis: planningAxisSchema,
  yAxis: planningAxisSchema
});
export type CreateMatrixPresetInput = z.infer<typeof createMatrixPresetInputSchema>;

export const updateMatrixPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  xAxis: planningAxisSchema.optional(),
  yAxis: planningAxisSchema.optional()
});
export type UpdateMatrixPresetInput = z.infer<typeof updateMatrixPresetInputSchema>;

/** Почему ось сейчас неприменима (текст для человека) или null, если применима. */
export function matrixAxisUnavailableReason(axis: PlanningAxis, availableCustomFieldIds: readonly string[]): string | null {
  if (axis.kind === "customFieldId" && !availableCustomFieldIds.includes(axis.field)) {
    return `Пользовательское поле «${axis.field}» не определено в этом пространстве — ось недоступна`;
  }
  return null;
}

/** Источник значения оси в конкретной установке — честная пометка вместо подмены поля. */
export const matrixAxisValueSourceSchema = z.enum(["field", "priority", "dueAt", "status", "customField", "none"]);
export type MatrixAxisValueSource = z.infer<typeof matrixAxisValueSourceSchema>;

export interface MatrixAxisValue {
  value: number;
  high: boolean;
  source: MatrixAxisValueSource;
}

export interface MatrixAxisTaskInput {
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  /**
   * Явные значения задачи 2.0 (`Task.importance`/`Task.urgency`, 0–3). Пока
   * колонок нет, поля не передаются — и ось честно сообщает источник
   * `priority`/`dueAt`, а не притворяется точным значением.
   */
  importance?: number | null;
  urgency?: number | null;
  customFields?: Readonly<Record<string, number | string | boolean | null>> | null;
}

const PRIORITY_VALUE: Record<TaskPriority, number> = { high: 3, normal: 1, low: 0 };

/**
 * Срочность по сроку, когда отдельного поля ещё нет: просрочено — 3, в
 * пределах суток — 2, трёх суток — 1, иначе 0. Закрытая задача срочной не
 * считается: её срок больше не действие, а факт.
 */
export function urgencyFromDueAt(dueAt: string | null, now: Date = new Date()): { value: number; source: MatrixAxisValueSource } {
  if (!dueAt) return { value: 0, source: "dueAt" };
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return { value: 0, source: "none" };
  const hours = (due - now.getTime()) / 3_600_000;
  if (hours <= 0) return { value: 3, source: "dueAt" };
  if (hours <= 24) return { value: 2, source: "dueAt" };
  if (hours <= 72) return { value: 1, source: "dueAt" };
  return { value: 0, source: "dueAt" };
}

function normalizeAxisValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PLANNING_AXIS_MAX_VALUE, Math.round(value)));
}

/**
 * Значение задачи на оси. Явное поле задачи всегда важнее проекции; проекция
 * помечается источником, чтобы клиент мог показать «срочность по сроку» и не
 * выдавать расчёт за введённое пользователем значение.
 */
export function matrixAxisValue(axis: PlanningAxis, task: MatrixAxisTaskInput, now: Date = new Date()): MatrixAxisValue {
  const withHigh = (value: number, source: MatrixAxisValueSource): MatrixAxisValue => {
    const normalized = normalizeAxisValue(value);
    return { value: normalized, high: normalized >= PLANNING_AXIS_HIGH_THRESHOLD, source };
  };
  switch (axis.kind) {
    case "importance": {
      if (typeof task.importance === "number") return withHigh(task.importance, "field");
      return withHigh(PRIORITY_VALUE[task.priority], "priority");
    }
    case "urgency": {
      if (typeof task.urgency === "number") return withHigh(task.urgency, "field");
      const due = urgencyFromDueAt(task.dueAt, now);
      return withHigh(due.value, due.source);
    }
    case "priority":
      return withHigh(PRIORITY_VALUE[task.priority], "priority");
    case "status": {
      // Открытая задача ближе к «действию», закрытая — к факту: 0 у done/canceled.
      if (task.status === "in_progress") return withHigh(2, "status");
      if (task.status === "todo") return withHigh(1, "status");
      return withHigh(0, "status");
    }
    case "customFieldId": {
      const raw = task.customFields?.[axis.field];
      if (typeof raw === "number") return withHigh(raw, "customField");
      if (typeof raw === "boolean") return withHigh(raw ? PLANNING_AXIS_MAX_VALUE : 0, "customField");
      return withHigh(0, "none");
    }
  }
}

// ---------------------------------------------------------------------------
// Матрица: чтение и запись квадранта
// ---------------------------------------------------------------------------

export const matrixAxisTaskInputSchema = z.object({
  priority: z.enum(["low", "normal", "high"]),
  status: taskStatusSchema,
  dueAt: z.string().nullable(),
  importance: z.number().int().nullable().optional(),
  urgency: z.number().int().nullable().optional(),
  customFields: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).nullable().optional()
});
export type MatrixAxisTaskInputSchema = z.infer<typeof matrixAxisTaskInputSchema>;

export const matrixAxisValueSchema = z.object({
  value: z.number().int(),
  high: z.boolean(),
  source: matrixAxisValueSourceSchema
});

/** Карточка задачи в квадранте: данные для показа и координаты, по которым она сюда попала. */
export const matrixTaskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: z.enum(["low", "normal", "high"]),
  dueAt: z.string().nullable(),
  assigneeId: z.string().nullable(),
  x: matrixAxisValueSchema,
  y: matrixAxisValueSchema
});
export type MatrixTaskCard = z.infer<typeof matrixTaskCardSchema>;

export const matrixCellSchema = z.object({
  id: matrixQuadrantIdSchema,
  label: z.string(),
  xHigh: z.boolean(),
  yHigh: z.boolean(),
  count: z.number().int(),
  /** Не больше `MATRIX_CELL_LIMIT` карточек; полный список — повторным запросом с `quadrant`. */
  tasks: z.array(matrixTaskCardSchema),
  truncated: z.boolean()
});
export type MatrixCell = z.infer<typeof matrixCellSchema>;

/** Сколько карточек отдаётся в ячейке: матрица — обзор, а не список задач. */
export const MATRIX_CELL_LIMIT = 60;

export const planningMatrixSchema = z.object({
  preset: matrixPresetSchema,
  /** Оси, приведённые к применимым: `note` объясняет недоступность. */
  axes: z.object({
    x: z.object({ axis: planningAxisSchema, available: z.boolean(), assignable: z.boolean(), note: z.string().nullable() }),
    y: z.object({ axis: planningAxisSchema, available: z.boolean(), assignable: z.boolean(), note: z.string().nullable() })
  }),
  quadrants: z.array(matrixCellSchema),
  /** true — хотя бы одна ось получает значения проекцией, а не явными полями задачи. */
  degraded: z.boolean(),
  notes: z.array(z.string()),
  /** Сколько задач пространства (с учётом фильтра проекта) попало в расчёт. */
  taskCount: z.number().int()
});
export type PlanningMatrix = z.infer<typeof planningMatrixSchema>;

export const assignMatrixCellInputSchema = z.object({
  taskId: z.string(),
  /** По умолчанию — встроенный Эйзенхауэр. */
  presetId: z.string().optional(),
  quadrant: matrixQuadrantIdSchema,
  /** Ревизия задачи, на которой основано действие (CAS): несовпадение — 409. */
  expectedRevision: z.number().int().optional()
});
export type AssignMatrixCellInput = z.infer<typeof assignMatrixCellInputSchema>;

export const matrixAssignmentSchema = z.object({
  axis: z.enum(["x", "y"]),
  /** Какое поле задачи реально записано: `importance`/`urgency`/`priority`/`field:<id>`. */
  field: z.string(),
  value: z.number().int()
});
export type MatrixAssignment = z.infer<typeof matrixAssignmentSchema>;

export const assignMatrixCellResultSchema = z.object({
  task: z.object({
    id: z.string(),
    revision: z.number().int(),
    importance: z.number().int().nullable(),
    urgency: z.number().int().nullable(),
    priority: z.enum(["low", "normal", "high"])
  }),
  applied: z.array(matrixAssignmentSchema),
  /** Оси, которые не удалось записать, с причиной — без молчаливого «получилось». */
  skipped: z.array(z.object({ axis: z.enum(["x", "y"]), reason: z.string() })),
  degraded: z.boolean()
});
export type AssignMatrixCellResult = z.infer<typeof assignMatrixCellResultSchema>;

// ---------------------------------------------------------------------------
// Тайм-блоки
// ---------------------------------------------------------------------------

export const PLANNING_BLOCK_TYPES = ["focus", "meeting", "buffer", "personal"] as const;
export const planningBlockTypeSchema = z.enum(PLANNING_BLOCK_TYPES);
export type PlanningBlockType = z.infer<typeof planningBlockTypeSchema>;

export const PLANNING_BLOCK_STATES = ["draft", "committed"] as const;
export const planningBlockStateSchema = z.enum(PLANNING_BLOCK_STATES);
export type PlanningBlockState = z.infer<typeof planningBlockStateSchema>;

/** Пересечение — предупреждение в ответе, не запрет: план можно сознательно наложить. */
export const planningConflictSchema = z.object({
  kind: z.enum(["event", "block"]),
  id: z.string(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  /** Длина пересечения в минутах (целые, всегда > 0). */
  minutes: z.number().int()
});
export type PlanningConflict = z.infer<typeof planningConflictSchema>;

export const planningBlockSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** Ссылка на задачу хранится как id: удаление задачи не удаляет блок. */
  taskId: z.string().nullable(),
  projectId: z.string().nullable(),
  title: z.string(),
  note: z.string(),
  type: planningBlockTypeSchema,
  state: planningBlockStateSchema,
  startAt: z.string(),
  endAt: z.string(),
  /** CAS-токен: +1 на каждой записи; `expectedRevision` в PATCH/move сверяется с ним. */
  revision: z.number().int(),
  /** Ключ идемпотентности клиента: повтор того же переноса не двигает блок второй раз. */
  clientMutationId: z.string().nullable(),
  /** Пересечения с событиями и другими блоками этого пространства. */
  conflicts: z.array(planningConflictSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type PlanningBlock = z.infer<typeof planningBlockSchema>;

const blockTitle = z.string().trim().min(1, "Название обязательно").max(200);

export const createPlanningBlockInputSchema = z
  .object({
    title: blockTitle,
    note: z.string().max(4_000).default(""),
    type: planningBlockTypeSchema.default("focus"),
    state: planningBlockStateSchema.default("draft"),
    taskId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    clientMutationId: z.string().min(8).max(120).nullable().optional()
  })
  .refine((input) => new Date(input.endAt).getTime() > new Date(input.startAt).getTime(), {
    message: "Конец должен быть позже начала",
    path: ["endAt"]
  });
export type CreatePlanningBlockInput = z.infer<typeof createPlanningBlockInputSchema>;

export const updatePlanningBlockInputSchema = z.object({
  title: blockTitle.optional(),
  note: z.string().max(4_000).optional(),
  type: planningBlockTypeSchema.optional(),
  state: planningBlockStateSchema.optional(),
  taskId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  expectedRevision: z.number().int().optional(),
  clientMutationId: z.string().min(8).max(120).nullable().optional()
});
export type UpdatePlanningBlockInput = z.infer<typeof updatePlanningBlockInputSchema>;

/** Перенос окна между днями: `endAt` не передан — сохраняется длительность блока. */
export const movePlanningBlockInputSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable().optional(),
  expectedRevision: z.number().int().optional(),
  clientMutationId: z.string().min(8).max(120).nullable().optional()
});
export type MovePlanningBlockInput = z.infer<typeof movePlanningBlockInputSchema>;

/**
 * «Что затронуто» переносом блока. Это оценка, а не действие: зависимые задачи
 * и их блоки не двигаются — сервер только говорит, что придётся подвинуть.
 */
export const planningBlockImpactSchema = z.object({
  taskId: z.string().nullable(),
  /** Сдвиг окна в минутах относительно прежнего начала (отрицательный — раньше). */
  shiftMinutes: z.number().int(),
  affectedTaskIds: z.array(z.string()),
  affectedBlockIds: z.array(z.string()),
  affectedMilestoneIds: z.array(z.string())
});
export type PlanningBlockImpact = z.infer<typeof planningBlockImpactSchema>;

export const planningBlockMoveResultSchema = z.object({
  block: planningBlockSchema,
  conflicts: z.array(planningConflictSchema),
  impact: planningBlockImpactSchema,
  /** true — этот `clientMutationId` уже применён, повтор ничего не изменил. */
  replayed: z.boolean()
});
export type PlanningBlockMoveResult = z.infer<typeof planningBlockMoveResultSchema>;

// ---------------------------------------------------------------------------
// Пересечения
// ---------------------------------------------------------------------------

export function intervalsOverlap(aStart: string | Date, aEnd: string | Date, bStart: string | Date, bEnd: string | Date): boolean {
  const aFrom = new Date(aStart).getTime();
  const aTo = new Date(aEnd).getTime();
  const bFrom = new Date(bStart).getTime();
  const bTo = new Date(bEnd).getTime();
  if (![aFrom, aTo, bFrom, bTo].every(Number.isFinite)) return false;
  return aFrom < bTo && bFrom < aTo;
}

/** Длина пересечения в целых минутах; 0, если интервалы не пересекаются. */
export function overlapMinutes(aStart: string | Date, aEnd: string | Date, bStart: string | Date, bEnd: string | Date): number {
  if (!intervalsOverlap(aStart, aEnd, bStart, bEnd)) return 0;
  const from = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime());
  const to = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime());
  return Math.max(0, Math.round((to - from) / 60_000));
}

// ---------------------------------------------------------------------------
// Гантт и критический путь (CPM)
// ---------------------------------------------------------------------------

export interface GanttTask {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  startAt: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  milestoneId: string | null;
  assigneeId: string | null;
  dependsOn: string[];
  /** Нижняя граница плана по CPM; null — задача не поставлена на шкалу (нет дат и оценки). */
  earliestStartAt: string | null;
  earliestFinishAt: string | null;
  totalFloatMinutes: number | null;
  critical: boolean;
}
export type GanttTaskItem = GanttTask;

export interface GanttMilestone {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  order: number;
  dependsOn: string[];
}

export const ganttConflictSchema = z.object({
  kind: z.enum(["dependency_order", "dependency_cycle", "assignee_overload", "missing_dates", "dependency_outside_project"]),
  taskId: z.string(),
  relatedTaskId: z.string().nullable(),
  /** Текст для человека: что именно нарушено. */
  message: z.string(),
  minutes: z.number().int().nullable()
});
export type GanttConflict = z.infer<typeof ganttConflictSchema>;

export const ganttResultSchema = z.object({
  projectId: z.string(),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: taskStatusSchema,
      projectId: z.string().nullable(),
      startAt: z.string().nullable(),
      dueAt: z.string().nullable(),
      estimatedMinutes: z.number().int().nullable(),
      milestoneId: z.string().nullable(),
      assigneeId: z.string().nullable(),
      dependsOn: z.array(z.string()),
      earliestStartAt: z.string().nullable(),
      earliestFinishAt: z.string().nullable(),
      totalFloatMinutes: z.number().int().nullable(),
      critical: z.boolean()
    })
  ),
  milestones: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      startAt: z.string().nullable(),
      dueAt: z.string().nullable(),
      estimatedMinutes: z.number().int().nullable(),
      order: z.number().int(),
      dependsOn: z.array(z.string())
    })
  ),
  criticalPath: z.array(z.string()),
  totalFloat: z.record(z.string(), z.number().int()),
  conflicts: z.array(ganttConflictSchema),
  /** Почему часть задач не попала в расчёт (нет дат, цикл зависимостей). */
  unscheduled: z.array(z.string()),
  cycles: z.array(z.string())
});
export type GanttResult = z.infer<typeof ganttResultSchema>;

export interface CpmTaskInput {
  id: string;
  startAt: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  dependsOn: readonly string[];
}

export interface CpmTaskResult {
  durationMinutes: number;
  earliestStartMinutes: number;
  earliestFinishMinutes: number;
  latestStartMinutes: number;
  latestFinishMinutes: number;
  totalFloatMinutes: number;
  critical: boolean;
}

export interface CpmResult {
  /** Только поставленные на шкалу задачи; порядок — топологический. */
  tasks: Record<string, CpmTaskResult>;
  order: string[];
  criticalPath: string[];
  /** Задачи с циклом зависимостей: расчёт для них невозможен. */
  cycles: string[];
  /** Задачи без дат и без оценки — ставить на шкалу нечем. */
  unscheduled: string[];
  /** Минуты от нуля плана до самого позднего финиша. */
  finishMinutes: number;
}

/**
 * Длительность задачи для CPM: явное окно важнее оценки; задача с одной датой
 * и без оценки — точка (0 минут), а не «неизвестно». Так веха-задача не рвёт
 * цепочку зависимостей.
 */
export function plannedDurationMinutes(task: Pick<CpmTaskInput, "startAt" | "dueAt" | "estimatedMinutes">): number | null {
  if (task.startAt && task.dueAt) {
    const diff = (new Date(task.dueAt).getTime() - new Date(task.startAt).getTime()) / 60_000;
    return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
  }
  if (typeof task.estimatedMinutes === "number") return Math.max(0, Math.round(task.estimatedMinutes));
  if (task.startAt || task.dueAt) return 0;
  return null;
}

/**
 * CPM: прямой проход (earliest start/finish) и обратный (latest start/finish)
 * по finish-to-start зависимостям `dependsOn`. Свободного запаса (lag) нет —
 * та же семантика, что у `TaskDependency`/`MilestoneDependency`: зависимая
 * задача не может начаться раньше финиша предшественника.
 *
 * Детерминированность важна для тестов и объяснений: при равном ES порядок
 * решается по id, поэтому один и тот же граф всегда даёт один и тот же путь.
 */
export function computeCriticalPath(input: readonly CpmTaskInput[]): CpmResult {
  const byId = new Map<string, CpmTaskInput>();
  for (const task of input) byId.set(task.id, task);

  const durations = new Map<string, number>();
  const unscheduled: string[] = [];
  for (const task of input) {
    const duration = plannedDurationMinutes(task);
    if (duration === null) unscheduled.push(task.id);
    else durations.set(task.id, duration);
  }

  const deps = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of durations.keys()) {
    indegree.set(id, 0);
    successors.set(id, []);
    deps.set(id, []);
  }
  for (const task of input) {
    if (!durations.has(task.id)) continue;
    for (const dep of task.dependsOn) {
      // Ссылка на задачу вне расчёта (другой проект/пространство или задача без
      // дат) не образует ребра: иначе она молча исказила бы весь путь.
      if (!durations.has(dep) || dep === task.id) continue;
      deps.get(task.id)!.push(dep);
      successors.get(dep)!.push(task.id);
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
    }
  }

  // Kahn, детерминированный: из готовых берём лексикографически первый id.
  const ready = [...durations.keys()].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of [...(successors.get(id) ?? [])].sort()) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) {
        // Вставка с сохранением порядка, чтобы ready оставался отсортированным.
        const at = ready.findIndex((candidate) => candidate > next);
        if (at === -1) ready.push(next);
        else ready.splice(at, 0, next);
      }
    }
  }
  const cycles = [...durations.keys()].filter((id) => !order.includes(id)).sort();

  const results = new Map<string, CpmTaskResult>();
  for (const id of order) {
    const duration = durations.get(id)!;
    const earliestStart = (deps.get(id) ?? []).reduce((max, dep) => Math.max(max, results.get(dep)?.earliestFinishMinutes ?? 0), 0);
    results.set(id, {
      durationMinutes: duration,
      earliestStartMinutes: earliestStart,
      earliestFinishMinutes: earliestStart + duration,
      latestStartMinutes: 0,
      latestFinishMinutes: 0,
      totalFloatMinutes: 0,
      critical: false
    });
  }
  const finishMinutes = [...results.values()].reduce((max, node) => Math.max(max, node.earliestFinishMinutes), 0);

  for (const id of [...order].reverse()) {
    const node = results.get(id)!;
    const own = successors.get(id) ?? [];
    const latestFinish = own.length
      ? own.reduce((min, next) => Math.min(min, results.get(next)?.latestStartMinutes ?? finishMinutes), Number.POSITIVE_INFINITY)
      : finishMinutes;
    const latestStart = latestFinish - node.durationMinutes;
    const totalFloat = latestStart - node.earliestStartMinutes;
    results.set(id, { ...node, latestStartMinutes: latestStart, latestFinishMinutes: latestFinish, totalFloatMinutes: totalFloat, critical: totalFloat === 0 });
  }

  // Путь — в топологическом порядке, а не по возрастанию ES: у нулевой по
  // длительности вехи ES совпадает с ES следующей задачи, и сортировка по ES
  // поставила бы её после зависимой задачи, хотя порядок работ обратный.
  const criticalPath = order.filter((id) => results.get(id)!.critical);

  return {
    tasks: Object.fromEntries(results),
    order,
    criticalPath,
    cycles,
    unscheduled,
    finishMinutes
  };
}

// ---------------------------------------------------------------------------
// Оценка последствий переноса (dry-run)
// ---------------------------------------------------------------------------

export interface ImpactTaskInput {
  id: string;
  title: string;
  startAt: string | null;
  dueAt: string | null;
  dependsOn: readonly string[];
  milestoneId: string | null;
}

export interface ImpactTask {
  id: string;
  title: string;
  previousStartAt: string | null;
  previousDueAt: string | null;
  nextStartAt: string | null;
  nextDueAt: string | null;
  shiftMinutes: number;
}

export interface ImpactMilestone {
  id: string;
  affectedTaskIds: string[];
  shiftMinutes: number;
}

export interface ReschedulePlan {
  task: ImpactTask;
  /** Только реально сдвигаемые зависимые задачи, по возрастанию сдвига. */
  tasks: ImpactTask[];
  milestones: ImpactMilestone[];
}

export const rescheduleImpactInputSchema = z
  .object({
    taskId: z.string(),
    newStartAt: z.string().datetime().nullable().optional(),
    newDueAt: z.string().datetime().nullable().optional()
  })
  .refine((input) => input.newStartAt !== undefined || input.newDueAt !== undefined, {
    message: "Укажите новый срок или новое начало",
    path: ["newStartAt"]
  });
export type RescheduleImpactInput = z.infer<typeof rescheduleImpactInputSchema>;

const impactTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  previousStartAt: z.string().nullable(),
  previousDueAt: z.string().nullable(),
  nextStartAt: z.string().nullable(),
  nextDueAt: z.string().nullable(),
  shiftMinutes: z.number().int()
});

export const impactMilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  previousDueAt: z.string().nullable(),
  nextDueAt: z.string().nullable(),
  shiftMinutes: z.number().int()
});

export const impactBlockSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  shiftMinutes: z.number().int()
});

export const impactEventSchema = z.object({
  /** Событие календаря, связанное с задачей через общую связь (`EntityLink`). */
  id: z.string(),
  shiftMinutes: z.number().int()
});

export const rescheduleImpactSchema = z.object({
  task: impactTaskSchema,
  tasks: z.array(impactTaskSchema),
  milestones: z.array(impactMilestoneSchema),
  blocks: z.array(impactBlockSchema),
  events: z.array(impactEventSchema)
});
export type RescheduleImpact = z.infer<typeof rescheduleImpactSchema>;

function minutesBetween(from: string | Date, to: string | Date): number | null {
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
  return Number.isFinite(diff) ? Math.round(diff) : null;
}

function shiftIso(value: string | null, shiftMinutes: number): string | null {
  if (!value) return null;
  const next = new Date(new Date(value).getTime() + shiftMinutes * 60_000);
  return Number.isFinite(next.getTime()) ? next.toISOString() : value;
}

/** Опорная дата задачи для каскада: начало, иначе срок. */
function anchorOf(task: { startAt: string | null; dueAt: string | null }): string | null {
  return task.startAt ?? task.dueAt;
}

/**
 * Finish-to-start каскад «если сдвинуть эту задачу, что поедет следом».
 *
 * Ничего не пишет: возвращает только предлагаемые даты — тот же принцип, что
 * `milestoneCascadeImpact` (S14a): пользователь сначала видит последствия и
 * подтверждает перенос отдельно. Задачи без дат не сдвигаются (сдвигать нечего),
 * и это видно по отсутствию в `tasks`.
 */
export function planReschedule(input: {
  tasks: readonly ImpactTaskInput[];
  movedTaskId: string;
  newStartAt?: string | null;
  newDueAt?: string | null;
}): ReschedulePlan | null {
  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  const moved = byId.get(input.movedTaskId);
  if (!moved) return null;

  const nextStart = new Map<string, string | null>();
  const nextDue = new Map<string, string | null>();
  for (const task of input.tasks) {
    nextStart.set(task.id, task.startAt);
    nextDue.set(task.id, task.dueAt);
  }
  if (input.newStartAt !== undefined) nextStart.set(moved.id, input.newStartAt);
  if (input.newDueAt !== undefined) nextDue.set(moved.id, input.newDueAt);

  const shiftOf = (task: ImpactTaskInput): number => {
    const previousAnchor = anchorOf(task);
    const nextAnchor = nextStart.get(task.id) ?? nextDue.get(task.id);
    if (!previousAnchor || !nextAnchor) return 0;
    return minutesBetween(previousAnchor, nextAnchor) ?? 0;
  };

  const dependents = new Map<string, string[]>();
  for (const task of input.tasks) {
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) continue;
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  // Релаксация до неподвижной точки: порядок зависимостей не обязан быть
  // топологическим во входе, а каскад должен сойтись. Счётчик проходов
  // страхует от бесконечного цикла в графе зависимостей (данные, а не наш
  // расчёт: цикл валидируется отдельно, здесь важнее не зависнуть).
  const queue: string[] = [moved.id];
  const maxPasses = input.tasks.length * input.tasks.length + 16;
  let pass = 0;
  while (queue.length > 0 && pass < maxPasses) {
    pass++;
    const id = queue.shift()!;
    const predecessorDue = nextDue.get(id) ?? nextStart.get(id);
    if (!predecessorDue) continue;
    for (const dependentId of dependents.get(id) ?? []) {
      const dependent = byId.get(dependentId)!;
      const anchor = anchorOf(dependent);
      if (!anchor) continue;
      if (new Date(anchor).getTime() >= new Date(predecessorDue).getTime()) continue;
      const shift = Math.round((new Date(predecessorDue).getTime() - new Date(anchor).getTime()) / 60_000);
      nextStart.set(dependentId, shiftIso(nextStart.get(dependentId) ?? null, shift));
      nextDue.set(dependentId, shiftIso(nextDue.get(dependentId) ?? null, shift));
      queue.push(dependentId);
    }
  }

  const toImpact = (task: ImpactTaskInput): ImpactTask => ({
    id: task.id,
    title: task.title,
    previousStartAt: task.startAt,
    previousDueAt: task.dueAt,
    nextStartAt: nextStart.get(task.id) ?? null,
    nextDueAt: nextDue.get(task.id) ?? null,
    shiftMinutes: shiftOf(task)
  });

  // У самой переносимой задачи сдвиг считается по тому полю, которое изменили:
  // «перенесли срок на час» — это сдвиг 60 минут, даже если начало не трогали
  // (у зависимых задач даты двигаются парой, поэтому для них работает anchor).
  let movedShift = 0;
  const difference = (previous: string | null, next: string | null): number =>
    previous && next ? minutesBetween(previous, next) ?? 0 : 0;
  if (input.newStartAt !== undefined) movedShift = difference(moved.startAt, nextStart.get(moved.id) ?? null);
  else if (input.newDueAt !== undefined) movedShift = difference(moved.dueAt, nextDue.get(moved.id) ?? null);

  const affected: ImpactTask[] = [];
  for (const task of input.tasks) {
    if (task.id === moved.id) continue;
    const impact = toImpact(task);
    if (impact.shiftMinutes !== 0) affected.push(impact);
  }
  // Порядок — хронологический каскад, а не по id: пользователю показывается
  // «что поедет следом» в том порядке, в котором это случится.
  affected.sort(
    (a, b) =>
      (a.nextStartAt ?? a.nextDueAt ?? "~").localeCompare(b.nextStartAt ?? b.nextDueAt ?? "~") ||
      a.id.localeCompare(b.id, "en")
  );

  const milestoneShifts = new Map<string, { affectedTaskIds: string[]; shiftMinutes: number }>();
  for (const impact of affected) {
    const milestoneId = byId.get(impact.id)?.milestoneId ?? null;
    if (!milestoneId) continue;
    const bucket = milestoneShifts.get(milestoneId) ?? { affectedTaskIds: [], shiftMinutes: 0 };
    bucket.affectedTaskIds.push(impact.id);
    bucket.shiftMinutes = Math.max(bucket.shiftMinutes, impact.shiftMinutes);
    milestoneShifts.set(milestoneId, bucket);
  }

  return {
    task: { ...toImpact(moved), shiftMinutes: movedShift },
    tasks: affected,
    milestones: [...milestoneShifts.entries()]
      .map(([id, bucket]) => ({ id, ...bucket }))
      .sort((a, b) => a.id.localeCompare(b.id, "en"))
  };
}

// ---------------------------------------------------------------------------
// Недельный ключ (`TimePlan.week`, ISO-8601)
// ---------------------------------------------------------------------------

const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

/** ISO-неделя даты как `2026-W45` — ключ недельного плана времени. */
export function isoWeekKey(date: Date = new Date()): string {
  // ISO: неделя принадлежит году, в котором лежит её четверг.
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function isIsoWeekKey(value: string): boolean {
  const match = WEEK_KEY.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

/** Понедельник 00:00 UTC и следующий понедельник для ключа недели. */
export function isoWeekRange(week: string): { from: Date; to: Date } {
  const match = WEEK_KEY.exec(week);
  if (!match) throw new Error(`Некорректный ключ недели: ${week}`);
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000);
  const from = new Date(week1Monday.getTime() + (weekNumber - 1) * 7 * 86_400_000);
  return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
}

/** Валидация ключа недели для пути/тела запроса (сужает `z.string()` до формата). */
export const isoWeekKeySchema = z.string().refine(isIsoWeekKey, "Ожидается неделя вида 2026-W45");
