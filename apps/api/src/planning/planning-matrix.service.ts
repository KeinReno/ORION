import { ConflictException, Injectable } from "@nestjs/common";
import {
  EISENHOWER_PRESET_ID,
  MATRIX_CELL_LIMIT,
  MATRIX_QUADRANT_IDS,
  MATRIX_QUADRANT_LABELS,
  isTaskClosed,
  matrixAxisUnavailableReason,
  matrixAxisValue,
  quadrantFor,
  quadrantTargets,
  type AssignMatrixCellInput,
  type AssignMatrixCellResult,
  type MatrixAssignment,
  type MatrixPreset,
  type MatrixQuadrantId,
  type MatrixTaskCard,
  type PlanningAxis,
  type PlanningMatrix,
  type UpdateTaskInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TaskFieldReader } from "../tasks/public/task-field-reader";
import { TaskOperations } from "../tasks/public/task-operations";
import { ProjectReferences } from "../projects/public/project-references";
import { PlanningMatrixPresetsService } from "./planning-matrix-presets.service";

export interface MatrixQuery {
  presetId?: string;
  projectId?: string;
}

/**
 * Матрица «важно/срочно» (задание 04, п. 4.3): ЕДИНСТВЕННОЕ представление, а не
 * хранилище. Квадрант вычисляется из полей задачи запросом; «запись в квадрант» —
 * это обычное обновление `importance`/`urgency` (или `priority`, пока поля не
 * заданы), через публичную команду Tasks, с ревизией и историей задачи.
 */
@Injectable()
export class PlanningMatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly taskOperations: TaskOperations,
    private readonly taskFields: TaskFieldReader,
    private readonly presets: PlanningMatrixPresetsService,
    private readonly projectReferences: ProjectReferences
  ) {}

  async matrix(userId: string, workspaceId: string, query: MatrixQuery = {}): Promise<PlanningMatrix> {
    // Задачи читаются публичной командой Tasks (свой контракт и своя проверка
    // членства), а собственные таблицы — в одной транзакции с проверкой осей.
    const tasks = (await this.taskOperations.list(userId, workspaceId)).filter(
      (task) =>
        (query.projectId ? task.projectId === query.projectId : true) && task.archivedAt === null && !isTaskClosed(task.status)
    );

    const { preset, fields, valuesByTask } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (query.projectId) {
        const exists = await this.projectReferences.existsTx(tx, workspaceId, query.projectId);
        if (!exists) throw new ConflictException({ code: "planning_project_not_found", message: "Проект не найден" });
      }
      const preset = await this.presets.resolveTx(tx, workspaceId, query.presetId ?? EISENHOWER_PRESET_ID);
      const fields = await this.taskFields.fieldsTx(tx, workspaceId);
      this.assertAxes(preset, fields.map((field) => field.id));
      const valuesByTask = await this.taskFields.valuesTx(tx, workspaceId, tasks.map((task) => task.id));
      return { preset, fields, valuesByTask };
    });

    const notes = new Set<string>();
    let degraded = false;
    const buckets = new Map<MatrixQuadrantId, MatrixTaskCard[]>(MATRIX_QUADRANT_IDS.map((id) => [id, []]));
    for (const task of tasks) {
      const axisTask = {
        priority: task.priority,
        status: task.status,
        dueAt: task.dueAt,
        importance: task.importance,
        urgency: task.urgency,
        customFields: valuesByTask[task.id] ?? null
      };
      const x = matrixAxisValue(preset.xAxis, axisTask);
      const y = matrixAxisValue(preset.yAxis, axisTask);
      if (isProjected(preset.xAxis, x.source)) {
        degraded = true;
        notes.add("Важность считается по приоритету: отдельное поле не задано.");
      }
      if (isProjected(preset.yAxis, y.source)) {
        degraded = true;
        notes.add("Срочность считается по сроку: отдельное поле не задано.");
      }
      buckets.get(quadrantFor(x.high, y.high))!.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        assigneeId: task.assigneeId,
        x,
        y
      });
    }

    const fieldIds = fields.map((field) => field.id);
    return {
      preset,
      axes: { x: axisInfo(preset.xAxis, fieldIds), y: axisInfo(preset.yAxis, fieldIds) },
      quadrants: MATRIX_QUADRANT_IDS.map((id) => {
        const cards = buckets.get(id)!;
        return {
          id,
          label: MATRIX_QUADRANT_LABELS[id],
          xHigh: quadrantTargets(id).x,
          yHigh: quadrantTargets(id).y,
          count: cards.length,
          tasks: cards.slice(0, MATRIX_CELL_LIMIT),
          truncated: cards.length > MATRIX_CELL_LIMIT
        };
      }),
      degraded,
      notes: [...notes],
      taskCount: tasks.length
    };
  }

  /**
   * Запись назначения в квадрант. Пишем только те оси, у которых есть настоящее
   * поле задачи; остальные честно перечислены в `skipped` — «частично применено»
   * не выдаётся за полный успех.
   */
  async assign(userId: string, workspaceId: string, input: AssignMatrixCellInput): Promise<AssignMatrixCellResult> {
    const { preset, fields } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const preset = await this.presets.resolveTx(tx, workspaceId, input.presetId ?? EISENHOWER_PRESET_ID);
      const fields = await this.taskFields.fieldsTx(tx, workspaceId);
      this.assertAxes(preset, fields.map((field) => field.id));
      return { preset, fields };
    });

    const targets = quadrantTargets(input.quadrant);
    const applied: MatrixAssignment[] = [];
    const skipped: Array<{ axis: "x" | "y"; reason: string }> = [];
    const patch: UpdateTaskInput = {};

    const plan = (axisKey: "x" | "y", axis: PlanningAxis, high: boolean): void => {
      switch (axis.kind) {
        case "importance":
          patch.importance = high ? 3 : 0;
          applied.push({ axis: axisKey, field: "importance", value: high ? 3 : 0 });
          return;
        case "urgency":
          patch.urgency = high ? 3 : 0;
          applied.push({ axis: axisKey, field: "urgency", value: high ? 3 : 0 });
          return;
        case "priority":
          patch.priority = high ? "high" : "low";
          applied.push({ axis: axisKey, field: "priority", value: high ? 3 : 0 });
          return;
        case "customFieldId": {
          const field = fields.find((candidate) => candidate.id === axis.field);
          if (!field) {
            skipped.push({ axis: axisKey, reason: `Пользовательское поле «${axis.field}» не найдено` });
            return;
          }
          if (field.type === "number") {
            patch.fieldValues = { ...(patch.fieldValues ?? {}), [field.id]: high ? 3 : 0 };
            applied.push({ axis: axisKey, field: `field:${field.id}`, value: high ? 3 : 0 });
            return;
          }
          if (field.type === "checkbox") {
            patch.fieldValues = { ...(patch.fieldValues ?? {}), [field.id]: high };
            applied.push({ axis: axisKey, field: `field:${field.id}`, value: high ? 1 : 0 });
            return;
          }
          skipped.push({ axis: axisKey, reason: `Поле «${field.name}» типа ${field.type} нельзя использовать как ось квадранта` });
          return;
        }
        case "status":
          skipped.push({ axis: axisKey, reason: "Ось статуса только для чтения: статус меняется в самой задаче" });
          return;
      }
    };

    plan("x", preset.xAxis, targets.x);
    plan("y", preset.yAxis, targets.y);

    if (applied.length === 0) {
      throw new ConflictException({
        code: "planning_axes_unavailable",
        message: "Ни одна ось этого пресета не записывается в задачу",
        skipped
      });
    }

    const task = await this.taskOperations.update(userId, workspaceId, input.taskId, {
      ...patch,
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {})
    });

    return {
      task: { id: task.id, revision: task.revision, importance: task.importance, urgency: task.urgency, priority: task.priority },
      applied,
      skipped,
      degraded: skipped.length > 0
    };
  }

  private assertAxes(preset: MatrixPreset, fieldIds: readonly string[]): void {
    for (const axis of [preset.xAxis, preset.yAxis]) {
      const reason = matrixAxisUnavailableReason(axis, fieldIds);
      if (reason) throw new ConflictException({ code: "planning_axis_unavailable", message: reason });
    }
  }
}

function axisInfo(axis: PlanningAxis, fieldIds: readonly string[]) {
  const reason = matrixAxisUnavailableReason(axis, fieldIds);
  return {
    axis,
    available: reason === null,
    // Статус — представление, а не поле квадранта; всё остальное пишется в задачу.
    assignable: axis.kind !== "status",
    note: reason
  };
}

function isProjected(axis: PlanningAxis, source: string): boolean {
  if (axis.kind === "importance") return source === "priority";
  if (axis.kind === "urgency") return source === "dueAt";
  return false;
}
