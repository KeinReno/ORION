import { ProjectTaskLinks } from "../projects/public/project-task-links";
import { MilestoneReferences } from "../milestones/public/milestone-references";
import { HomeReferences } from "../home/public/home-references";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
// Value import, not `import type`: `Prisma.DbNull` / `Prisma.InputJsonValue` are
// runtime values. Importing the namespace as a type only compiles the type
// positions and breaks the value ones (TS1361) — the same trap documented for
// events.service.ts in PLAN v0.11.
import { Prisma } from "@prisma/client";
import type {
  CreateSavedTaskViewInput,
  CreateTaskInput,
  SavedTaskView,
  Task,
  TaskChecklistItem,
  TaskRecurrence,
  TaskViewFilters,
  UpdateTaskInput
} from "@orion/shared-types";
import { isPluginEnabled, isTaskClosed, taskChecklistItemSchema } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { DomainEventBus } from "../domain-events/domain-event-bus";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { assertAssigneeInWorkspace } from "./task-refs.util";
import { TaskClosureRegistry } from "./public/task-closure-registry";

const taskInclude = {
  dependsOn: { include: { dependsOn: { select: { status: true } } } }
} satisfies Prisma.TaskInclude;
type TaskModel = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

@Injectable()
export class TasksService {
  constructor(
    private readonly homes: HomeReferences,
    private readonly projectLinks: ProjectTaskLinks,
    private readonly milestoneReferences: MilestoneReferences,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: DomainEventBus,
    private readonly closures: TaskClosureRegistry
  ) {}

  async list(userId: string, workspaceId: string, search?: string, assignedToMe?: boolean): Promise<Task[]> {
    const tasks = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const assigneeId = assignedToMe
        ? (await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }))?.id
        : undefined;
      const query = search?.trim();
      if (!query) {
        return tx.task.findMany({
          where: { workspaceId, ...(assigneeId ? { assigneeId } : {}) },
          include: taskInclude,
          orderBy: [{ sortOrder: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
        });
      }
      const matches = await tx.$queryRaw<Array<{ id: string; rank: number }>>`
        SELECT id, ts_rank(
          to_tsvector('russian', "title" || ' ' || "description" || ' ' || coalesce("projectTag", '')),
          websearch_to_tsquery('russian', ${query})
        ) AS rank
        FROM "tasks"
        WHERE "workspaceId" = ${workspaceId}
          AND to_tsvector('russian', "title" || ' ' || "description" || ' ' || coalesce("projectTag", ''))
              @@ websearch_to_tsquery('russian', ${query})
        ORDER BY rank DESC
      `;
      if (!matches.length) return [];
      const rows = await tx.task.findMany({
        where: { id: { in: matches.map((match) => match.id) }, ...(assigneeId ? { assigneeId } : {}) },
        include: taskInclude
      });
      const order = new Map(matches.map((match, index) => [match.id, index]));
      return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    });
    return tasks.map(toDto);
  }

  /** `agentName` is set only by the AI Bridge (ADR-0007): it leaves a `created` journal row marked as the agent's. */
  async create(userId: string, workspaceId: string, input: CreateTaskInput, agentName?: string): Promise<Task> {
    const task = await this.prisma.withUser(userId, async (tx) => {
      const created = await this.createTx(tx, userId, workspaceId, input);
      if (agentName) {
        await tx.taskActivity.create({
          data: { workspaceId, taskId: created.id, actorId: userId, field: "created", toValue: created.title, agentName }
        });
      }
      return created;
    });
    return toDto(task);
  }

  /** Agent capture uses the same transaction for the task and its creation journal. */
  async createFromAgentTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput, agentName: string) {
    const task = await this.createTx(tx, userId, workspaceId, input);
    await tx.taskActivity.create({ data: { workspaceId, taskId: task.id, actorId: userId, field: "created", toValue: task.title, agentName } });
    return { id: task.id };
  }

  /**
   * The body of `create()`, minus the `withUser` wrap — pulled out so
   * `SearchService.createAndLink` (U03 Часть 1) can run it inside the SAME
   * transaction as the `EntityLink` it creates alongside. Callers own the
   * transaction (and the leading `assertMemberTx`, already done once by
   * every existing caller before reaching here); this method does not open
   * or close one itself, and does not re-check membership — it trusts the
   * caller's transaction was already gated.
   */
  async createTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, input: CreateTaskInput, clientId?: string): Promise<TaskModel> {
    const project = await this.resolveProjectTx(tx, workspaceId, input.projectId, input.projectTag);
    await this.assertParentTx(tx, workspaceId, input.parentId ?? null);
    const dependencyIds = unique(input.dependencyIds ?? []);
    await this.assertDependenciesTx(tx, workspaceId, null, dependencyIds);
    if (input.assigneeId !== undefined) await this.assertAssigneeWriteTx(tx, userId, workspaceId, input.assigneeId);
    if (input.milestoneId) await this.assertMilestoneTx(tx, workspaceId, input.milestoneId, project?.id ?? null);
    if (input.homeId) await this.homes.assertTx(tx, workspaceId, input.homeId);
    const created = await tx.task.create({
      data: {
        ...(clientId ? { id: clientId } : {}),
        workspaceId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        projectId: project?.id ?? null,
        projectTag: project?.name ?? input.projectTag ?? null,
        parentId: input.parentId ?? null,
        assigneeId: input.assigneeId ?? null,
        startAt: input.startAt ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        milestoneId: input.milestoneId ?? null,
        homeId: input.homeId ?? null,
        checklist: input.checklist as unknown as Prisma.InputJsonValue,
        recurrence: input.recurrence ? (input.recurrence as Prisma.InputJsonValue) : Prisma.DbNull
      }
    });
    if (dependencyIds.length) {
      await tx.taskDependency.createMany({ data: dependencyIds.map((dependsOnTaskId) => ({ workspaceId, taskId: created.id, dependsOnTaskId })) });
    }
    await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: created.id } });
    return tx.task.findUniqueOrThrow({ where: { id: created.id }, include: taskInclude });
  }

  /** `agentName`: see `create()` — stamps the journal rows of this edit as the agent's. */
  async update(userId: string, workspaceId: string, taskId: string, rawInput: UpdateTaskInput, agentName?: string): Promise<Task> {
    const task = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.updateTx(tx, userId, workspaceId, taskId, rawInput, agentName);
    });
    return toDto(task);
  }

  /** Тело `update()` без обёртки `withUser` — им пользуется гибридная синхронизация (ADR-0016); членство проверил вызывающий. */
  async updateTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string, rawInput: UpdateTaskInput, agentName?: string): Promise<TaskModel> {
    const { expectedRevision, ...input } = rawInput;
    {
      const current = await this.assertOwnedTx(tx, workspaceId, taskId);
      const data: Prisma.TaskUncheckedUpdateInput = {};

      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
      if (input.dueAt !== undefined) {
        data.dueAt = input.dueAt;
        data.notifiedAt = null;
      }
      if (input.recurrence !== undefined) data.recurrence = input.recurrence ? (input.recurrence as Prisma.InputJsonValue) : Prisma.DbNull;
      if (input.parentId !== undefined) {
        await this.assertParentTx(tx, workspaceId, input.parentId, taskId);
        data.parentId = input.parentId;
      }
      if (input.projectId !== undefined || input.projectTag !== undefined) {
        const project = await this.resolveProjectTx(tx, workspaceId, input.projectId, input.projectTag);
        data.projectId = project?.id ?? null;
        data.projectTag = project?.name ?? input.projectTag ?? null;
      }
      if (input.assigneeId !== undefined) {
        await this.assertAssigneeWriteTx(tx, userId, workspaceId, input.assigneeId);
        data.assigneeId = input.assigneeId;
      }
      if (input.estimatedMinutes !== undefined) data.estimatedMinutes = input.estimatedMinutes;
      if (input.milestoneId !== undefined) {
        if (input.milestoneId) {
          const projectId = input.projectId !== undefined ? input.projectId : current.projectId;
          await this.assertMilestoneTx(tx, workspaceId, input.milestoneId, projectId);
        }
        data.milestoneId = input.milestoneId;
      }
      const datesChanged = input.startAt !== undefined || input.dueAt !== undefined;
      if (input.startAt !== undefined) data.startAt = input.startAt;
      if (input.checklist !== undefined) data.checklist = input.checklist as unknown as Prisma.InputJsonValue;

      const firstCompletion = input.status === "done" && current.status !== "done";
      if (input.status !== undefined) {
        data.status = input.status;
        data.completedAt = input.status === "done" ? new Date() : null;
      }

      // S17 audit log — status/assignee/due are the only three fields
      // tracked (see TaskActivity doc comment in schema.prisma), diffed
      // against `current` (the pre-update row) before the write below.
      const activityRows: Prisma.TaskActivityCreateManyInput[] = [];
      if (input.status !== undefined && input.status !== current.status) {
        activityRows.push({ workspaceId, taskId, actorId: userId, field: "status", fromValue: current.status, toValue: input.status, agentName: agentName ?? null });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
        activityRows.push({
          workspaceId,
          taskId,
          actorId: userId,
          field: "assigneeId",
          fromValue: current.assigneeId,
          toValue: input.assigneeId,
          agentName: agentName ?? null
        });
      }
      if (input.dueAt !== undefined) {
        const nextDueAtIso = input.dueAt ?? null;
        const currentDueAtIso = current.dueAt ? current.dueAt.toISOString() : null;
        if (nextDueAtIso !== currentDueAtIso) {
          activityRows.push({ workspaceId, taskId, actorId: userId, field: "dueAt", fromValue: currentDueAtIso, toValue: nextDueAtIso, agentName: agentName ?? null });
        }
      }

      // Optimistic concurrency, like notes: the revision check is part of the UPDATE's WHERE, so two editors that
      // both read the same revision cannot both win. Callers that send no `expectedRevision` (board drag, quick
      // actions) keep last-write-wins but still bump the revision, so an open detail pane notices the change.
      const written = await tx.task.updateMany({
        where: { id: taskId, ...(expectedRevision !== undefined ? { revision: expectedRevision } : {}) },
        data: { ...data, revision: { increment: 1 } }
      });
      if (written.count === 0) {
        const latest = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
        throw new ConflictException({
          code: "task_revision_conflict",
          message: "Задачу изменил кто-то другой, пока вы редактировали — загрузите последнюю версию",
          currentRevision: latest.revision,
          current: toDto(latest)
        });
      }
      if (activityRows.length) await tx.taskActivity.createMany({ data: activityRows });

      if (datesChanged) await cascadeRescheduleTx(tx, taskId);

      // Optional neighbors own their synchronous consequences (ADR-0027).
      const closedNow =
        input.status !== undefined && isTaskClosed(input.status) && !isTaskClosed(current.status);
      if (closedNow) {
        await this.closures.closeTx(tx, { workspaceId, taskId });
      }

      // Event API (ADR-0019): the outbox row is written in this very transaction, so a rolled-back update (revision
      // conflict, failed validation below) publishes nothing. Subscribers react later, via the dispatcher.
      if (closedNow) {
        await this.events.publishTx(tx, {
          workspaceId,
          type: "tasks.task.closed",
          actorId: userId,
          payload: {
            id: taskId,
            projectId: data.projectId !== undefined ? (data.projectId as string | null) : current.projectId,
            assigneeId: data.assigneeId !== undefined ? (data.assigneeId as string | null) : current.assigneeId,
            status: input.status!
          }
        });
      }

      if (input.dependencyIds !== undefined) {
        const dependencyIds = unique(input.dependencyIds);
        await this.assertDependenciesTx(tx, workspaceId, taskId, dependencyIds);
        await tx.taskDependency.deleteMany({ where: { taskId } });
        if (dependencyIds.length) {
          await tx.taskDependency.createMany({ data: dependencyIds.map((dependsOnTaskId) => ({ workspaceId, taskId, dependsOnTaskId })) });
        }
      }

      const recurrence = (input.recurrence === undefined ? current.recurrence : input.recurrence) as TaskRecurrence | null;
      const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt ? new Date(input.dueAt) : null;
      if (firstCompletion && recurrence && dueAt) {
        const nextDueAt = advanceDate(dueAt, recurrence);
        // projectId/projectTag are resolved together by resolveProjectTx
        // whenever *either* is present in the input (see above) — falling
        // back to `current` must check both, or supplying only one of the
        // two pairs a freshly-resolved field with the other's stale value.
        const projectTouched = input.projectId !== undefined || input.projectTag !== undefined;
        const next = await tx.task.create({
          data: {
            workspaceId,
            projectId: projectTouched ? (data.projectId as string | null) : current.projectId,
            parentId: input.parentId === undefined ? current.parentId : input.parentId,
            title: input.title ?? current.title,
            description: input.description ?? current.description,
            priority: input.priority ?? current.priority,
            dueAt: nextDueAt,
            projectTag: projectTouched ? (data.projectTag as string | null) : current.projectTag,
            recurrence: recurrence as Prisma.InputJsonValue,
            sortOrder: input.sortOrder ?? current.sortOrder,
            assigneeId: input.assigneeId === undefined ? current.assigneeId : data.assigneeId as string | null,
            checklist: (input.checklist ?? readChecklist(current.checklist)).map((item) => ({ ...item, done: false })) as unknown as Prisma.InputJsonValue
          }
        });
        await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: next.id } });
        const dependencyIds = input.dependencyIds ?? current.dependsOn.map((dependency) => dependency.dependsOnTaskId);
        if (dependencyIds.length) {
          await tx.taskDependency.createMany({ data: dependencyIds.map((dependsOnTaskId) => ({ workspaceId, taskId: next.id, dependsOnTaskId })) });
        }
      }

      await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: taskId } });
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
    }
  }

  async remove(userId: string, workspaceId: string, taskId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, taskId);
      await tx.task.delete({ where: { id: taskId } });
      await this.events.publishTx(tx, { workspaceId, actorId: userId, type: "tasks.task.changed", payload: { id: taskId } });
    });
  }

  async listViews(userId: string, workspaceId: string): Promise<SavedTaskView[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.savedTaskView.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
    });
    return rows.map(viewDto);
  }

  async createView(userId: string, workspaceId: string, input: CreateSavedTaskViewInput): Promise<SavedTaskView> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const duplicate = await tx.savedTaskView.findFirst({ where: { workspaceId, name: { equals: input.name, mode: "insensitive" } } });
      if (duplicate) throw new ConflictException("Представление с таким названием уже существует");
      return tx.savedTaskView.create({ data: { workspaceId, name: input.name, filters: input.filters as Prisma.InputJsonValue } });
    });
    return viewDto(row);
  }

  async deleteView(userId: string, workspaceId: string, viewId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const result = await tx.savedTaskView.deleteMany({ where: { id: viewId, workspaceId } });
      if (!result.count) throw new NotFoundException("Представление не найдено");
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string): Promise<TaskModel> {
    const task = await tx.task.findUnique({ where: { id: taskId }, include: taskInclude });
    if (!task || task.workspaceId !== workspaceId) throw new NotFoundException("Задача не найдена");
    return task;
  }

  private async assertParentTx(tx: Prisma.TransactionClient, workspaceId: string, parentId: string | null, taskId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === taskId) throw new BadRequestException("Задача не может быть подзадачей самой себя");
    const parent = await tx.task.findUnique({ where: { id: parentId } });
    if (!parent || parent.workspaceId !== workspaceId) throw new NotFoundException("Родительская задача не найдена");
    if (!taskId) return;
    let cursor = parent.parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === taskId) throw new BadRequestException("Нельзя создать цикл подзадач");
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = (await tx.task.findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId ?? null;
    }
  }

  private async assertDependenciesTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string | null, ids: string[]): Promise<void> {
    if (taskId && ids.includes(taskId)) throw new BadRequestException("Задача не может зависеть от самой себя");
    const found = await tx.task.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true } });
    if (found.length !== ids.length) throw new NotFoundException("Одна из зависимостей не найдена");
    if (!taskId) return;
    for (const dependencyId of ids) {
      const reachesCurrent = await dependsOn(tx, dependencyId, taskId);
      if (reachesCurrent) throw new BadRequestException("Нельзя создать циклическую зависимость задач");
    }
  }

  /**
   * Writing assigneeId (including clearing it) requires the "Команда" plugin
   * — see PLUGIN_CATALOG. Reading/keeping an existing value never does.
   * Assigning to someone *other than yourself* additionally requires
   * owner/lead — self-assign and clearing stay open to any member.
   */
  private async assertAssigneeWriteTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    assigneeId: string | null
  ): Promise<void> {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
    if (!isPluginEnabled(workspace?.pluginOverrides, "team")) {
      throw new ConflictException('Плагин «Команда» выключен в этом пространстве');
    }
    if (!assigneeId) return;
    await assertAssigneeInWorkspace(tx, workspaceId, assigneeId);
    const caller = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (caller?.id !== assigneeId) {
      await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
    }
  }

  private async resolveProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId?: string | null, projectTag?: string | null) {
    if (projectId) {
      const project = await this.projectLinks.byIdTx(tx, workspaceId, projectId);
      if (!project) throw new NotFoundException("Проект не найден");
      return project;
    }
    const name = projectTag?.trim();
    if (!name) return null;
    return this.projectLinks.findOrCreateByNameTx(tx, workspaceId, name);
  }

  /** A task's milestone must belong to the *same project* as the task — grouping a task under another project's phase would make the Gantt lie about which project owns that plan. */
  private async assertMilestoneTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    milestoneId: string,
    taskProjectId: string | null
  ): Promise<void> {
    const milestone = await this.milestoneReferences.findTx(tx, workspaceId, milestoneId);
    if (!milestone) throw new NotFoundException("Веха не найдена");
    if (!taskProjectId || milestone.projectId !== taskProjectId) {
      throw new BadRequestException("Веха должна принадлежать тому же проекту, что и задача");
    }
  }
}

/**
 * After task `taskId`'s dates changed, push forward any direct or transitive
 * dependent whose `startAt` now precedes its (freshly re-read) predecessors'
 * `dueAt` — same finish-to-start auto-schedule as `MilestonesService`'s
 * cascade, one Gantt level down. See that function's comment for why it's
 * one-directional.
 */
async function cascadeRescheduleTx(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
  const visited = new Set<string>([taskId]);
  let frontier = [taskId];
  while (frontier.length) {
    const edges = await tx.taskDependency.findMany({
      where: { dependsOnTaskId: { in: frontier } },
      select: { taskId: true }
    });
    const candidateIds = [...new Set(edges.map((edge) => edge.taskId))].filter((id) => !visited.has(id));
    if (!candidateIds.length) break;
    candidateIds.forEach((id) => visited.add(id));

    const changed: string[] = [];
    for (const dependentId of candidateIds) {
      const dependent = await tx.task.findUniqueOrThrow({ where: { id: dependentId } });
      const predecessorRows = await tx.taskDependency.findMany({
        where: { taskId: dependentId },
        include: { dependsOn: { select: { dueAt: true } } }
      });
      const requiredStart = predecessorRows.reduce<Date | null>((max, row) => {
        const finish = row.dependsOn.dueAt;
        return finish && (!max || finish > max) ? finish : max;
      }, null);
      if (!requiredStart) continue;
      if (dependent.startAt && dependent.startAt >= requiredStart) continue;

      const duration = dependent.startAt && dependent.dueAt ? dependent.dueAt.getTime() - dependent.startAt.getTime() : null;
      const newStart = requiredStart;
      const newDue = duration !== null ? new Date(newStart.getTime() + duration) : dependent.dueAt && dependent.dueAt > newStart ? dependent.dueAt : newStart;
      await tx.task.update({ where: { id: dependentId }, data: { startAt: newStart, dueAt: newDue } });
      changed.push(dependentId);
    }
    frontier = changed;
  }
}

async function dependsOn(tx: Prisma.TransactionClient, fromTaskId: string, targetTaskId: string): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [fromTaskId];
  while (frontier.length) {
    if (frontier.includes(targetTaskId)) return true;
    const next = await tx.taskDependency.findMany({ where: { taskId: { in: frontier } }, select: { dependsOnTaskId: true } });
    frontier = next.map((item) => item.dependsOnTaskId).filter((id) => !visited.has(id));
    frontier.forEach((id) => visited.add(id));
  }
  return false;
}

function advanceDate(date: Date, recurrence: TaskRecurrence): Date {
  const next = new Date(date);
  if (recurrence.freq === "daily") next.setUTCDate(next.getUTCDate() + recurrence.interval);
  else if (recurrence.freq === "weekly") next.setUTCDate(next.getUTCDate() + recurrence.interval * 7);
  else if (recurrence.freq === "monthly") next.setUTCMonth(next.getUTCMonth() + recurrence.interval);
  else next.setUTCFullYear(next.getUTCFullYear() + recurrence.interval);
  return next;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function readChecklist(value: Prisma.JsonValue | undefined): TaskChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: TaskChecklistItem[] = [];
  for (const item of value) {
    const parsed = taskChecklistItemSchema.safeParse(item);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

function toDto(task: TaskModel): Task {
  const dependencyIds = task.dependsOn.map((dependency) => dependency.dependsOnTaskId);
  return {
    id: task.id,
    revision: task.revision,
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    parentId: task.parentId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    projectTag: task.projectTag,
    recurrence: task.recurrence as TaskRecurrence | null,
    completedAt: task.completedAt?.toISOString() ?? null,
    sortOrder: task.sortOrder,
    dependencyIds,
    blocked: task.dependsOn.some((dependency) => !isTaskClosed(dependency.dependsOn.status)),
    assigneeId: task.assigneeId,
    startAt: task.startAt?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    milestoneId: task.milestoneId,
    checklist: readChecklist(task.checklist),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

function viewDto(row: { id: string; workspaceId: string; name: string; filters: Prisma.JsonValue; createdAt: Date; updatedAt: Date }): SavedTaskView {
  return { id: row.id, workspaceId: row.workspaceId, name: row.name, filters: row.filters as TaskViewFilters, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export { toDto as toTaskDto };
