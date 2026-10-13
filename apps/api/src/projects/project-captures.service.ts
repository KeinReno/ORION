import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, ProjectCapture as CaptureRow } from "@prisma/client";
import type {
  CreateProjectCaptureInput,
  CreateProjectProblemInput,
  ProjectCapture,
  ProjectCaptureKind,
  UpdateProjectCaptureInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Ideas and problems are the same record with a different `kind`, each behind
 * its own plugin. The thought stays on the project until `promote` creates a
 * real task through TasksService — this module does not invent a second task
 * store. A later host (finance, home) would be another plugin, not a column here.
 */
@Injectable()
export class ProjectCapturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService
  ) {}

  async list(userId: string, workspaceId: string, projectId: string, kind: ProjectCaptureKind): Promise<ProjectCapture[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      return tx.projectCapture.findMany({
        where: { workspaceId, projectId, kind },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
    });
    return rows.map(toDto);
  }

  async create(
    userId: string,
    workspaceId: string,
    projectId: string,
    kind: ProjectCaptureKind,
    input: CreateProjectCaptureInput | CreateProjectProblemInput
  ): Promise<ProjectCapture> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      return tx.projectCapture.create({
        data: {
          workspaceId,
          projectId,
          kind,
          title: input.title,
          body: input.body,
          severity: kind === "problem" && "severity" in input ? input.severity : null
        }
      });
    });
    return toDto(row);
  }

  async update(
    userId: string,
    workspaceId: string,
    projectId: string,
    captureId: string,
    kind: ProjectCaptureKind,
    input: UpdateProjectCaptureInput
  ): Promise<ProjectCapture> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, projectId, captureId, kind);
      return tx.projectCapture.update({
        where: { id: captureId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(kind === "problem" && input.severity !== undefined ? { severity: input.severity } : {})
        }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, projectId: string, captureId: string, kind: ProjectCaptureKind): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, projectId, captureId, kind);
      await tx.projectCapture.delete({ where: { id: captureId } });
    });
  }

  /**
   * One task, once. A second click returns the same row. A dismissed thought
   * has to be reopened first, so "не актуально" is not silently turned into work.
   * The tasks module must be on — creating a task is that module's job.
   */
  async promote(userId: string, workspaceId: string, projectId: string, captureId: string, kind: ProjectCaptureKind): Promise<ProjectCapture> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
      // Лок строки: параллельные «Сделать задачей» ждут и видят уже проставленный taskId.
      await tx.$queryRaw`SELECT id FROM "project_captures" WHERE id = ${captureId} FOR UPDATE`;
      const current = await this.assertOwnedTx(tx, workspaceId, projectId, captureId, kind);
      if (current.status === "dismissed") {
        throw new BadRequestException("Сначала верните запись из закрытых");
      }
      if (current.taskId) return current;
      const task = await this.tasks.createTx(tx, userId, workspaceId, {
        title: current.title,
        description: current.body,
        priority: "normal",
        projectId: current.projectId
      });
      return tx.projectCapture.update({
        where: { id: captureId },
        data: { status: "promoted", taskId: task.id }
      });
    });
    return toDto(row);
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }

  private async assertOwnedTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    captureId: string,
    kind: ProjectCaptureKind
  ): Promise<CaptureRow> {
    const row = await tx.projectCapture.findUnique({ where: { id: captureId } });
    if (!row || row.workspaceId !== workspaceId || row.projectId !== projectId || row.kind !== kind) {
      throw new NotFoundException(kind === "idea" ? "Идея не найдена" : "Проблема не найдена");
    }
    return row;
  }
}

function toDto(row: CaptureRow): ProjectCapture {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    status: row.status,
    severity: row.severity,
    taskId: row.taskId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
