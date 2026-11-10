import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateProjectLogEntryInput, CreateProjectRelationInput, ProjectLogEntry, ProjectRelation } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { TaskReferenceReader } from "../tasks/public/task-reference-reader";
import { WorkspacesService } from "../workspaces/workspaces.service";

const ENTRY_LIMIT = 200;
type Tx = Parameters<Parameters<PrismaService["withUser"]>[1]>[0];

@Injectable()
export class ProjectLogbookService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly taskReferences: TaskReferenceReader) {}

  async listEntries(userId: string, workspaceId: string, projectId: string): Promise<ProjectLogEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, userId, workspaceId, projectId);
      const rows = await tx.projectLogEntry.findMany({
        where: { workspaceId, projectId },
        include: { author: { select: { id: true, name: true } }, tasks: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: ENTRY_LIMIT
      });
      const taskDetails = await this.taskDetails(tx, workspaceId, rows.flatMap((row) => row.tasks.map((link) => link.taskId)));
      return rows.map((row) => ({
        id: row.id, workspaceId, projectId, kind: row.kind, text: row.text,
        authorId: row.authorId, authorName: row.author.name, mine: row.authorId === userId,
        createdAt: row.createdAt.toISOString(),
        tasks: row.tasks.flatMap(({ taskId, comment }) => {
          const task = taskDetails.get(taskId);
          return task ? [{ ...task, comment, url: null }] : [];
        })
      }));
    });
  }

  async createEntry(userId: string, workspaceId: string, projectId: string, input: CreateProjectLogEntryInput): Promise<ProjectLogEntry> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, userId, workspaceId, projectId);
      const taskIds = input.tasks.map((item) => item.taskId);
      if (taskIds.length) {
        const tasks = await this.taskReferences.byIdsTx(tx, workspaceId, taskIds);
        if (tasks.length !== taskIds.length) throw new NotFoundException("Одна из задач не найдена в этом пространстве");
      }
      const row = await tx.projectLogEntry.create({
        data: {
          workspaceId, projectId, authorId: userId, kind: input.kind, text: input.text,
          tasks: { create: input.tasks.map(({ taskId, comment }) => ({ workspaceId, taskId, comment })) }
        },
        include: { author: { select: { id: true, name: true } }, tasks: true }
      });
      const taskDetails = await this.taskDetails(tx, workspaceId, taskIds);
      return {
        id: row.id, workspaceId, projectId, kind: row.kind, text: row.text, authorId: userId,
        authorName: row.author.name, mine: true, createdAt: row.createdAt.toISOString(),
        tasks: row.tasks.flatMap(({ taskId, comment }) => {
          const task = taskDetails.get(taskId);
          return task ? [{ ...task, comment, url: null }] : [];
        })
      };
    });
  }

  async removeEntry(userId: string, workspaceId: string, projectId: string, entryId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.projectLogEntry.findUnique({ where: { id: entryId } });
      if (!row || row.workspaceId !== workspaceId || row.projectId !== projectId || row.authorId !== userId) {
        throw new NotFoundException("Запись не найдена");
      }
      await tx.projectLogEntry.delete({ where: { id: entryId } });
    });
  }

  async listRelations(userId: string, workspaceId: string, projectId: string): Promise<ProjectRelation[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, userId, workspaceId, projectId);
      const rows = await tx.projectRelation.findMany({
        where: { workspaceId, OR: [{ fromProjectId: projectId }, { toProjectId: projectId }] },
        include: { fromProject: { select: { id: true, name: true } }, toProject: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      return rows.map((row) => ({
        id: row.id, type: row.type, fromProjectId: row.fromProjectId, toProjectId: row.toProjectId,
        fromProjectName: row.fromProject.name, toProjectName: row.toProject.name,
        createdAt: row.createdAt.toISOString(), mine: row.createdById === userId
      }));
    });
  }

  async createRelation(userId: string, workspaceId: string, projectId: string, input: CreateProjectRelationInput): Promise<ProjectRelation> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertProject(tx, userId, workspaceId, projectId);
      if (input.toProjectId === projectId) throw new ConflictException("Нельзя связать проект с самим собой");
      const target = await tx.project.findFirst({ where: { id: input.toProjectId, workspaceId }, select: { id: true, name: true } });
      if (!target) throw new NotFoundException("Связанный проект не найден в этом пространстве");
      const current = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, name: true } });
      // "Связан с" is symmetric; persist one canonical direction so adding it from
      // the opposite project's page cannot create a duplicate pair.
      const from = input.type === "related" && current.id > target.id ? target : current;
      const to = input.type === "related" && current.id > target.id ? current : target;
      try {
        const row = await tx.projectRelation.create({ data: { workspaceId, fromProjectId: from.id, toProjectId: to.id, type: input.type, createdById: userId } });
        return { id: row.id, type: row.type, fromProjectId: from.id, toProjectId: to.id, fromProjectName: from.name, toProjectName: to.name, createdAt: row.createdAt.toISOString(), mine: true };
      } catch (error) {
        if (hasPrismaCode(error, "P2002")) throw new ConflictException("Такая связь уже добавлена");
        throw error;
      }
    });
  }

  async removeRelation(userId: string, workspaceId: string, projectId: string, relationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.projectRelation.findUnique({ where: { id: relationId } });
      if (!row || row.workspaceId !== workspaceId || (row.fromProjectId !== projectId && row.toProjectId !== projectId) || row.createdById !== userId) {
        throw new NotFoundException("Связь не найдена");
      }
      await tx.projectRelation.delete({ where: { id: relationId } });
    });
  }

  private async assertProject(tx: Tx, userId: string, workspaceId: string, projectId: string): Promise<void> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    const project = await tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
    if (!project) throw new NotFoundException("Проект не найден");
  }

  private async taskDetails(tx: Tx, workspaceId: string, taskIds: string[]) {
    const tasks = await this.taskReferences.byIdsTx(tx, workspaceId, [...new Set(taskIds)]);
    const projectIds = [...new Set(tasks.flatMap((task) => task.projectId ? [task.projectId] : []))];
    const projects = projectIds.length ? await tx.project.findMany({ where: { workspaceId, id: { in: projectIds } }, select: { id: true, name: true } }) : [];
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    return new Map(tasks.map((task) => [task.id, {
      id: task.id, title: task.title, status: task.status, projectId: task.projectId,
      projectName: task.projectId ? projectNames.get(task.projectId) ?? null : null
    }]));
  }
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
