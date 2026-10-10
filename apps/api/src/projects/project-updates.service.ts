import { Injectable, NotFoundException } from "@nestjs/common";
import type { ProjectStatusUpdate as UpdateRow, User } from "@prisma/client";
import { PROJECT_HEALTH_LABEL, type CreateProjectUpdateInput, type ProjectHealth, type ProjectUpdate } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
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
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService
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

  /**
   * A report that says the project is `at_risk` or `delayed` tells the other members of the
   * workspace (never the author); a routine «по плану» does not — it would be noise. The
   * notification is written in its own `asSystem` transaction, outside the author's `withUser`
   * one, because RLS only lets a session insert a row addressed to itself (same reasoning as task
   * comments). `eventKey` makes a retried request a no-op; quiet hours of each recipient apply.
   */
  async create(userId: string, workspaceId: string, projectId: string, input: CreateProjectUpdateInput): Promise<ProjectUpdate> {
    const { dto, recipients, projectName } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { workspaceId: true, name: true } });
      if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
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
      const members =
        input.health === "on_track"
          ? []
          : await tx.workspaceMember.findMany({ where: { workspaceId, NOT: { userId } }, select: { userId: true } });
      return { dto: toDto(created, userId), recipients: members.map((member) => member.userId), projectName: project.name };
    });

    for (const recipientId of recipients) {
      if (!(await this.policy.allowsForUser(recipientId, "entity"))) continue;
      await this.prisma.asSystem((tx) =>
        this.notifications.createTx(tx, {
          workspaceId,
          recipientId,
          kind: "project_update",
          eventKey: `project_update:${dto.id}`,
          actorId: userId,
          title: `${projectName}: ${PROJECT_HEALTH_LABEL[input.health].toLowerCase()}`,
          body: input.summary.length > 200 ? `${input.summary.slice(0, 200)}…` : input.summary,
          entityType: "project",
          entityId: projectId
        })
      );
    }
    return dto;
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
