import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  computeCriticalPath,
  overlapMinutes,
  plannedDurationMinutes,
  planReschedule,
  type GanttConflict,
  type GanttMilestone,
  type GanttResult,
  type GanttTaskItem,
  type ImpactTaskInput,
  type RescheduleImpact,
  type RescheduleImpactInput,
  type Task
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TaskOperations } from "../tasks/public/task-operations";
import { MilestoneTimelineReader } from "../milestones/public/milestone-timeline";
import { ProjectReferences } from "../projects/public/project-references";

/** Веха как строка Гантта: у вехи нет статуса задачи, только её собственный. */
const MAX_OVERLOAD_CONFLICTS = 50;

/**
 * Гантт и критический путь (задание 04, п. 4.2).
 *
 * Никаких новых таблиц: задачи приходят из публичного `TaskOperations` (у DTO уже
 * есть `startAt`, `dueAt`, `estimatedMinutes`, `dependencyIds`, `milestoneId`),
 * вехи — из `MilestoneTimelineReader`, проект проверяется `ProjectReferences`.
 * Расчёт CPM — чистый `computeCriticalPath` в shared-types, поэтому его проверяет
 * unit-тест на эталонном графе, а не интеграционный сценарий на глаз.
 */
@Injectable()
export class PlanningGanttService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly taskOperations: TaskOperations,
    private readonly milestones: MilestoneTimelineReader,
    private readonly projectReferences: ProjectReferences
  ) {}

  async gantt(userId: string, workspaceId: string, projectId: string): Promise<GanttResult> {
    const milestoneRows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      return this.milestones.byProjectTx(tx, workspaceId, projectId);
    });

    const allTasks = await this.taskOperations.list(userId, workspaceId);
    const projectTasks = allTasks.filter((task) => task.projectId === projectId && task.archivedAt === null);
    const projectTaskIds = new Set(projectTasks.map((task) => task.id));

    const cpm = computeCriticalPath(
      projectTasks.map((task) => ({
        id: task.id,
        startAt: task.startAt,
        dueAt: task.dueAt,
        estimatedMinutes: task.estimatedMinutes,
        dependsOn: task.dependencyIds.filter((dependencyId) => projectTaskIds.has(dependencyId))
      }))
    );

    const baseline = this.baselineMinutes(projectTasks);
    const tasks: GanttTaskItem[] = projectTasks
      .map((task) => {
        const node = cpm.tasks[task.id];
        return {
          id: task.id,
          title: task.title,
          status: task.status,
          projectId: task.projectId,
          startAt: task.startAt,
          dueAt: task.dueAt,
          estimatedMinutes: task.estimatedMinutes,
          milestoneId: task.milestoneId,
          assigneeId: task.assigneeId,
          dependsOn: task.dependencyIds,
          earliestStartAt: node && baseline !== null ? new Date(baseline + node.earliestStartMinutes * 60_000).toISOString() : null,
          earliestFinishAt: node && baseline !== null ? new Date(baseline + node.earliestFinishMinutes * 60_000).toISOString() : null,
          totalFloatMinutes: node ? node.totalFloatMinutes : null,
          critical: node?.critical ?? false
        };
      })
      .sort((a, b) => (a.earliestStartAt ?? a.startAt ?? "~").localeCompare(b.earliestStartAt ?? b.startAt ?? "~") || a.id.localeCompare(b.id, "en"));

    const milestones: GanttMilestone[] = milestoneRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      startAt: row.startAt ? row.startAt.toISOString() : null,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      estimatedMinutes: row.estimatedMinutes,
      order: row.order,
      dependsOn: row.dependencyIds
    }));

    const conflicts = this.conflicts(projectTasks, projectTaskIds, cpm);

    return {
      projectId,
      tasks,
      milestones,
      criticalPath: cpm.criticalPath,
      totalFloat: Object.fromEntries(Object.entries(cpm.tasks).map(([id, node]) => [id, node.totalFloatMinutes])),
      conflicts,
      unscheduled: cpm.unscheduled,
      cycles: cpm.cycles
    };
  }

  /**
   * Dry-run «что поедет, если сдвинуть задачу». Ничего не пишет — как
   * `milestoneCascadeImpact`: пользователь сначала видит последствия.
   */
  async rescheduleImpact(userId: string, workspaceId: string, input: RescheduleImpactInput): Promise<RescheduleImpact> {
    const tasks = await this.taskOperations.list(userId, workspaceId);
    const nodes: ImpactTaskInput[] = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      startAt: task.startAt,
      dueAt: task.dueAt,
      dependsOn: task.dependencyIds,
      milestoneId: task.milestoneId
    }));
    const plan = planReschedule({
      tasks: nodes,
      movedTaskId: input.taskId,
      newStartAt: input.newStartAt,
      newDueAt: input.newDueAt
    });
    if (!plan) throw new NotFoundException("Задача не найдена");

    const affectedIds = new Set([input.taskId, ...plan.tasks.map((task) => task.id)]);
    const shiftByTask = new Map<string, number>([[input.taskId, plan.task.shiftMinutes]]);
    for (const task of plan.tasks) shiftByTask.set(task.id, task.shiftMinutes);

    const { blocks, eventIds } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const blockRows = await tx.planningBlock.findMany({
        where: { workspaceId, taskId: { in: [...affectedIds] } },
        select: { id: true, title: true, startAt: true, endAt: true, taskId: true }
      });
      const links = await tx.entityLink.findMany({
        where: {
          workspaceId,
          OR: [
            { sourceType: "task", sourceId: { in: [...affectedIds] } },
            { targetType: "task", targetId: { in: [...affectedIds] } }
          ]
        },
        select: { sourceType: true, sourceId: true, targetType: true, targetId: true }
      });
      const eventIds: Array<{ id: string; taskId: string }> = [];
      for (const link of links) {
        const taskSide = link.sourceType === "task" ? { type: link.targetType, id: link.targetId, taskId: link.sourceId } : { type: link.sourceType, id: link.sourceId, taskId: link.targetId };
        if (taskSide.type === "event") eventIds.push({ id: taskSide.id, taskId: taskSide.taskId });
      }
      return { blocks: blockRows, eventIds };
    });

    const milestoneIds = new Set(plan.milestones.map((milestone) => milestone.id));
    const milestoneRows = milestoneIds.size
      ? await this.prisma.withUser(userId, async (tx) => {
          await this.workspaces.assertMemberTx(tx, userId, workspaceId);
          return this.milestones.byIdsTx(tx, workspaceId, [...milestoneIds]);
        })
      : [];
    const milestoneById = new Map(milestoneRows.map((row) => [row.id, row]));

    return {
      task: plan.task,
      tasks: plan.tasks,
      milestones: plan.milestones.map((milestone) => {
        const row = milestoneById.get(milestone.id);
        const previousDueAt = row?.dueAt ? row.dueAt.toISOString() : null;
        return {
          id: milestone.id,
          title: row?.title ?? milestone.id,
          previousDueAt,
          nextDueAt: shiftIso(previousDueAt, milestone.shiftMinutes),
          shiftMinutes: milestone.shiftMinutes
        };
      }),
      blocks: blocks.map((block) => {
        const shiftMinutes = shiftByTask.get(block.taskId ?? "") ?? 0;
        return {
          id: block.id,
          title: block.title,
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          shiftMinutes
        };
      }),
      events: eventIds.map((event) => ({ id: event.id, shiftMinutes: shiftByTask.get(event.taskId) ?? 0 }))
    };
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    if (!(await this.projectReferences.existsTx(tx, workspaceId, projectId))) {
      throw new NotFoundException("Проект не найден");
    }
  }

  /** Левый край шкалы: самое раннее начало среди задач, у которых оно выводимо. */
  private baselineMinutes(tasks: readonly { startAt: string | null; dueAt: string | null; estimatedMinutes: number | null }[]): number | null {
    let baseline: number | null = null;
    for (const task of tasks) {
      const duration = plannedDurationMinutes(task);
      if (duration === null) continue;
      const start = task.startAt
        ? new Date(task.startAt).getTime()
        : task.dueAt
          ? new Date(task.dueAt).getTime() - duration * 60_000
          : null;
      if (start === null || !Number.isFinite(start)) continue;
      baseline = baseline === null ? start : Math.min(baseline, start);
    }
    return baseline;
  }

  private conflicts(tasks: readonly Task[], projectTaskIds: ReadonlySet<string>, cpm: ReturnType<typeof computeCriticalPath>): GanttConflict[] {
    const conflicts: GanttConflict[] = [];
    const byId = new Map(tasks.map((task) => [task.id, task]));

    for (const task of tasks) {
      for (const dependencyId of task.dependencyIds) {
        if (!projectTaskIds.has(dependencyId)) {
          conflicts.push({
            kind: "dependency_outside_project",
            taskId: task.id,
            relatedTaskId: dependencyId,
            message: "Зависимость указывает на задачу другого проекта — в расчёт пути она не входит",
            minutes: null
          });
          continue;
        }
        const dependency = byId.get(dependencyId);
        if (!task.startAt || !dependency?.dueAt) continue;
        const minutes = Math.round((new Date(task.startAt).getTime() - new Date(dependency.dueAt).getTime()) / 60_000);
        if (minutes < 0) {
          conflicts.push({
            kind: "dependency_order",
            taskId: task.id,
            relatedTaskId: dependencyId,
            message: `«${task.title}» начинается раньше, чем заканчивается «${dependency.title}»`,
            minutes: -minutes
          });
        }
      }
    }

    for (const id of cpm.cycles) {
      conflicts.push({
        kind: "dependency_cycle",
        taskId: id,
        relatedTaskId: null,
        message: "Цикл зависимостей: критический путь для этой задачи не определён",
        minutes: null
      });
    }
    for (const id of cpm.unscheduled) {
      const task = byId.get(id);
      conflicts.push({
        kind: "missing_dates",
        taskId: id,
        relatedTaskId: null,
        message: `«${task?.title ?? id}» без дат и оценки — поставить на шкалу нечем`,
        minutes: null
      });
    }

    // Перегрузка исполнителя: пересекающиеся окна задач одного человека. Это
    // предупреждение для планировщика, а не ограничение — две задачи может вести
    // один человек, просто последовательно.
    const byAssignee = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.assigneeId || !task.startAt || !task.dueAt) continue;
      const bucket = byAssignee.get(task.assigneeId) ?? [];
      bucket.push(task);
      byAssignee.set(task.assigneeId, bucket);
    }
    for (const bucket of byAssignee.values()) {
      const sorted = [...bucket].sort((a, b) => (a.startAt ?? "").localeCompare(b.startAt ?? ""));
      for (let left = 0; left < sorted.length && conflicts.length < MAX_OVERLOAD_CONFLICTS; left++) {
        for (let right = left + 1; right < sorted.length; right++) {
          const a = sorted[left]!;
          const b = sorted[right]!;
          const overlap = overlapMinutes(a.startAt!, a.dueAt!, b.startAt!, b.dueAt!);
          if (overlap <= 0) continue;
          conflicts.push({
            kind: "assignee_overload",
            taskId: b.id,
            relatedTaskId: a.id,
            message: `У исполнителя пересекаются задачи «${a.title}» и «${b.title}»`,
            minutes: overlap
          });
          if (conflicts.length >= MAX_OVERLOAD_CONFLICTS) break;
        }
      }
    }

    return conflicts;
  }
}

function shiftIso(value: string | null, shiftMinutes: number): string | null {
  if (!value) return null;
  return new Date(new Date(value).getTime() + shiftMinutes * 60_000).toISOString();
}
