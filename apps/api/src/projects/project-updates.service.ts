import { Injectable, NotFoundException } from "@nestjs/common";
import type { ProjectStatusUpdate as UpdateRow, User } from "@prisma/client";
import type { CreateProjectUpdateInput, ProjectHealth, ProjectUpdate } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Newest first; the overview shows the latest and a short history, not an archive browser. */
const LIST_LIMIT = 50;

type RowWithAuthor = UpdateRow & { author: Pick<User, "id" | "name"> };

/**
 * UI-05 «Обновление состояния проекта». Append-only by design: the history of
 * reports is the feature, so there is no update endpoint. Only the author may
 * delete their own report (a typo'd or mistaken one) — same rule as task
 * comments, no moderation override invented.
 *
 * Every method asserts membership and runs under `withUser`, and a project id
 * is checked against *this* workspace (a user in two workspaces can see both
 * rows under RLS, so RLS alone does not stop mixing them).
 */
@Injectable()
export class ProjectUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, projectId: string): Promise<ProjectUpdate[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      const rows = await tx.projectStatusUpdate.findMany({
        where: { workspaceId, projectId },
        include: { author: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIST_LIMIT
      });
      return rows.map((row) => toDto(row, userId));
    });
  }

  async create(userId: string, workspaceId: string, projectId: string, input: CreateProjectUpdateInput): Promise<ProjectUpdate> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, workspaceId, projectId);
      const created = await tx.projectStatusUpdate.create({
        data: {
          workspaceId,
          projectId,
          authorId: userId,
          health: input.health,
          summary: input.summary,
          blocker: input.blocker,
          nextStep: input.nextStep
        },
        include: { author: { select: { id: true, name: true } } }
      });
      return toDto(created, userId);
    });
  }

  async remove(userId: string, workspaceId: string, projectId: string, updateId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.projectStatusUpdate.findUnique({ where: { id: updateId } });
      if (!existing || existing.workspaceId !== workspaceId || existing.projectId !== projectId) {
        throw new NotFoundException("Обновление не найдено");
      }
      // Someone else's report is reported as missing, not forbidden: it does not
      // confirm to a non-author that the id exists.
      if (existing.authorId !== userId) throw new NotFoundException("Обновление не найдено");
      await tx.projectStatusUpdate.delete({ where: { id: existing.id } });
    });
  }

  private async assertProjectTx(tx: Parameters<Parameters<PrismaService["withUser"]>[1]>[0], workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }
}

function toDto(row: RowWithAuthor, viewerId: string): ProjectUpdate {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    health: row.health as ProjectHealth,
    summary: row.summary,
    blocker: row.blocker,
    nextStep: row.nextStep,
    authorId: row.authorId,
    authorName: row.author.name,
    mine: row.authorId === viewerId,
    createdAt: row.createdAt.toISOString()
  };
}
