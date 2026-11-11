import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  entryMinutes,
  isoWeekKey,
  isIsoWeekKey,
  type SetTimePlanInput,
  type TimeAnalytics,
  type TimeAnalyticsTaskPlan,
  type TimeAnalyticsWeekPlan,
  type TimePlan
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { TaskEstimateReader } from "../tasks/public/task-estimate-reader";

export interface TimeAnalyticsFilters {
  from?: string;
  to?: string;
  projectId?: string;
}

export interface TimePlanFilters {
  fromWeek?: string;
  toWeek?: string;
}

type PlanRow = Prisma.TimePlanGetPayload<Record<string, never>>;

/**
 * Аналитика план/факт и недельный план (задание 04, п. 4.4).
 *
 * Факт — те же записи времени и та же `entryMinutes`, что и в таймере; план — две
 * РАЗНЫЕ вещи, которые нельзя складывать молча: оценка самой задачи
 * (`Task.estimatedMinutes`, приходит из Tasks) и намерение на неделю (`TimePlan`).
 * Неизвестная оценка остаётся `null`, а не нулём: «не оценили» и «оценили в ноль»
 * — разные утверждения (то же правило, что у `Project.hourlyRate`).
 */
@Injectable()
export class TimeAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly taskEstimates: TaskEstimateReader
  ) {}

  async analytics(userId: string, workspaceId: string, filters: TimeAnalyticsFilters = {}): Promise<TimeAnalytics> {
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    if (from && Number.isNaN(from.getTime())) throw new BadRequestException("Некорректное начало периода");
    if (to && Number.isNaN(to.getTime())) throw new BadRequestException("Некорректный конец периода");
    if (from && to && from >= to) throw new BadRequestException("Начало периода должно быть раньше конца");

    const { entries, plans, taskEstimates } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const entries = await tx.timeEntry.findMany({
        where: {
          workspaceId,
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(from || to
            ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
            : {})
        },
        select: { taskId: true, projectId: true, startedAt: true, endedAt: true, pausedSeconds: true, pausedAt: true }
      });
      const weekBounds = from && to ? { gte: isoWeekKey(from), lte: isoWeekKey(to) } : undefined;
      const plans = await tx.timePlan.findMany({
        where: { workspaceId, ...(weekBounds ? { week: weekBounds } : {}) },
        orderBy: { week: "asc" }
      });
      // Оценки задач — узкий публичный контракт Tasks: полный модуль задач не нужен.
      const taskIds = [...new Set(entries.map((entry) => entry.taskId).filter((id): id is string => Boolean(id)))];
      const taskEstimates = await this.taskEstimates.byIdsTx(tx, workspaceId, taskIds);
      return { entries, plans, taskEstimates };
    });

    const now = new Date();
    let minutes = 0;
    let linkedMinutes = 0;
    let freeMinutes = 0;
    const byProject = new Map<string | null, { minutes: number; count: number }>();
    const byTask = new Map<string | null, { minutes: number; count: number }>();
    const byWeek = new Map<string, number>();

    for (const entry of entries) {
      const worked = entryMinutes(
        {
          startedAt: entry.startedAt.toISOString(),
          endedAt: entry.endedAt ? entry.endedAt.toISOString() : null,
          pausedSeconds: entry.pausedSeconds,
          pausedAt: entry.pausedAt ? entry.pausedAt.toISOString() : null
        },
        now
      );
      minutes += worked;
      const projectBucket = byProject.get(entry.projectId) ?? { minutes: 0, count: 0 };
      projectBucket.minutes += worked;
      projectBucket.count += 1;
      byProject.set(entry.projectId, projectBucket);
      const taskBucket = byTask.get(entry.taskId) ?? { minutes: 0, count: 0 };
      taskBucket.minutes += worked;
      taskBucket.count += 1;
      byTask.set(entry.taskId, taskBucket);
      if (entry.taskId) linkedMinutes += worked;
      else freeMinutes += worked;
      const week = isoWeekKey(entry.startedAt);
      byWeek.set(week, (byWeek.get(week) ?? 0) + worked);
    }

    // Оценки задач приходят из публичного контракта Tasks: своего чтения задач у
    // учёта времени нет (и не должно быть).
    const estimateById = new Map(taskEstimates.map((task) => [task.id, task]));
    const taskPlans: TimeAnalyticsTaskPlan[] = [];
    let estimatedMinutes = 0;
    let estimatedTaskCount = 0;
    let unknownEstimateTaskCount = 0;
    for (const [taskId, bucket] of byTask) {
      if (!taskId) continue;
      const task = estimateById.get(taskId);
      const estimate = task?.estimatedMinutes ?? null;
      if (estimate === null) unknownEstimateTaskCount += 1;
      else {
        estimatedTaskCount += 1;
        estimatedMinutes += estimate;
      }
      taskPlans.push({
        taskId,
        title: task?.title ?? "",
        estimatedMinutes: estimate,
        actualMinutes: bucket.minutes,
        remainingMinutes: estimate === null ? null : estimate - bucket.minutes,
        overrun: estimate !== null && bucket.minutes > estimate
      });
    }
    taskPlans.sort((a, b) => b.actualMinutes - a.actualMinutes || a.taskId.localeCompare(b.taskId, "en"));

    const planByWeek = new Map(plans.map((plan) => [plan.week, plan.plannedMinutes]));
    const weekKeys = new Set<string>([...byWeek.keys(), ...planByWeek.keys()]);
    const weeks: TimeAnalyticsWeekPlan[] = [...weekKeys]
      .sort()
      .map((week) => ({ week, plannedMinutes: planByWeek.get(week) ?? null, actualMinutes: byWeek.get(week) ?? 0 }));

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      projectId: filters.projectId ?? null,
      totals: { minutes, count: entries.length, linkedMinutes, freeMinutes },
      byProject: [...byProject.entries()]
        .map(([projectId, bucket]) => ({ projectId, minutes: bucket.minutes, count: bucket.count }))
        .sort((a, b) => b.minutes - a.minutes || (a.projectId ?? "").localeCompare(b.projectId ?? "", "en")),
      byTask: [...byTask.entries()]
        .map(([taskId, bucket]) => ({ taskId, minutes: bucket.minutes, count: bucket.count }))
        .sort((a, b) => b.minutes - a.minutes || (a.taskId ?? "").localeCompare(b.taskId ?? "", "en")),
      plan: {
        estimatedMinutes: estimatedTaskCount > 0 ? estimatedMinutes : null,
        estimatedTaskCount,
        unknownEstimateTaskCount,
        tasks: taskPlans,
        weeks
      }
    };
  }

  async plans(userId: string, workspaceId: string, filters: TimePlanFilters = {}): Promise<TimePlan[]> {
    for (const week of [filters.fromWeek, filters.toWeek]) {
      if (week && !isIsoWeekKey(week)) throw new BadRequestException("Ожидается неделя вида 2026-W45");
    }
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.timePlan.findMany({
        where: {
          workspaceId,
          ...(filters.fromWeek || filters.toWeek
            ? { week: { ...(filters.fromWeek ? { gte: filters.fromWeek } : {}), ...(filters.toWeek ? { lte: filters.toWeek } : {}) } }
            : {})
        },
        orderBy: { week: "asc" }
      });
      return rows.map(toDto);
    });
  }

  async setPlan(userId: string, workspaceId: string, week: string, input: SetTimePlanInput): Promise<TimePlan> {
    if (!isIsoWeekKey(week)) throw new BadRequestException("Ожидается неделя вида 2026-W45");
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.timePlan.upsert({
        where: { workspaceId_week: { workspaceId, week } },
        create: { workspaceId, week, plannedMinutes: input.plannedMinutes, note: input.note },
        update: { plannedMinutes: input.plannedMinutes, note: input.note }
      });
      return toDto(row);
    });
  }

  async removePlan(userId: string, workspaceId: string, week: string): Promise<void> {
    if (!isIsoWeekKey(week)) throw new BadRequestException("Ожидается неделя вида 2026-W45");
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.timePlan.findUnique({ where: { workspaceId_week: { workspaceId, week } } });
      if (!existing) throw new NotFoundException("План на эту неделю не задан");
      await tx.timePlan.delete({ where: { id: existing.id } });
    });
  }
}

function toDto(row: PlanRow): TimePlan {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    week: row.week,
    plannedMinutes: row.plannedMinutes,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
