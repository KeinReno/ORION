import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, TaskComment as TaskCommentRow, User } from "@prisma/client";
import type { CreateTaskCommentInput, TaskComment, TaskCommentPage, UpdateTaskCommentInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { NotificationCenterService } from "../notifications/notification-center.service";
import { NotificationPolicyService } from "../notifications/notification-policy.service";
import { MentionsService } from "../notifications/mentions.service";

/** `list()` pagination knobs — mirrors `TimePageOptions` (S15). */
export interface TaskCommentPageOptions {
  cursor?: string;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type CommentWithAuthor = TaskCommentRow & { author: Pick<User, "id" | "name"> };

/**
 * ORION S17 «Комментарии задач». A plain REST CRUD resource — no chat, no
 * presence, no websockets (explicitly out of scope per 10-BACKLOG.md S17):
 * the client re-fetches via react-query like every other panel.
 *
 * Ownership: only the comment's own author may edit/delete it. There is no
 * owner/lead moderation override — checked against 08-TEAM-AND-ACCESS.md,
 * which documents no such carve-out for comments, so none is invented here.
 *
 * Author identity survives workspace-membership removal by construction:
 * `userId` is a `User` FK, not a `WorkspaceMember` one (see schema.prisma),
 * and `WorkspacesService.assertMemberTx` only gates who can *read/write*
 * comments right now — it never touches who wrote past ones.
 */
@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly notifications: NotificationCenterService,
    private readonly policy: NotificationPolicyService,
    private readonly mentions: MentionsService
  ) {}

  /** Cursor-paginated, newest first (same composite-cursor shape as `TimeService.list`, S15). */
  async list(userId: string, workspaceId: string, taskId: string, page: TaskCommentPageOptions = {}): Promise<TaskCommentPage> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertTaskTx(tx, workspaceId, taskId);

      const where: Prisma.TaskCommentWhereInput = { workspaceId, taskId };
      if (page.cursor) {
        const cursorRow = await tx.taskComment.findUnique({
          where: { id: page.cursor },
          select: { id: true, workspaceId: true, taskId: true, createdAt: true }
        });
        if (!cursorRow || cursorRow.workspaceId !== workspaceId || cursorRow.taskId !== taskId) {
          throw new BadRequestException("Курсор пагинации недействителен для этой задачи");
        }
        where.OR = [
          { createdAt: { lt: cursorRow.createdAt } },
          { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } }
        ];
      }

      const limit = Math.min(Math.max(1, page.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
      const rows = await tx.taskComment.findMany({
        where,
        include: { author: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1
      });
      const hasMore = rows.length > limit;
      const page_ = hasMore ? rows.slice(0, limit) : rows;
      return {
        items: page_.map((row) => toDto(row, userId)),
        nextCursor: hasMore ? page_[page_.length - 1]!.id : null
      };
    });
  }

  /**
   * `userId` is stamped from the authenticated session — `CreateTaskCommentInput`
   * has no such field, so there is nothing in the client payload that could
   * override it (see the zod schema in packages/shared-types/src/task-comment.ts).
   *
   * Notifies the task's assignee (if any, and not the commenter themself) —
   * `NotificationCenterService.createTx` already no-ops on self-notify and on
   * a repeated `eventKey`, so a retried request never double-notifies.
   */
  async create(userId: string, workspaceId: string, taskId: string, input: CreateTaskCommentInput): Promise<TaskComment> {
    const { comment, recipientId, taskTitle } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const task = await this.assertTaskTx(tx, workspaceId, taskId);
      const created = await tx.taskComment.create({
        data: { workspaceId, taskId, userId, body: input.body },
        include: { author: { select: { id: true, name: true } } }
      });
      const recipientId = task.assigneeId
        ? (await tx.workspaceMember.findUnique({ where: { id: task.assigneeId }, select: { userId: true } }))?.userId ?? null
        : null;
      return { comment: created, recipientId, taskTitle: task.title };
    });

    // Notifying happens in its own `asSystem` transaction, deliberately
    // outside the `withUser(userId, …)` one above: `notifications`' RLS
    // policy only lets a session insert a row whose `recipientId` matches
    // `app.current_user_id` — fine for the crons (which already run under
    // `asSystem`) but not here, where the *actor* (the commenter) and the
    // *recipient* (the assignee) are two different people. `createTx`'s own
    // self-notify/eventKey-dedup guards apply exactly the same either way.
    if (recipientId && (await this.policy.allowsForUser(recipientId, "task"))) {
      await this.prisma.asSystem((tx) =>
        this.notifications.createTx(tx, {
          workspaceId,
          recipientId,
          kind: "task_comment",
          eventKey: `task_comment:${comment.id}`,
          actorId: userId,
          title: `Новый комментарий к задаче: ${taskTitle}`,
          body: input.body.length > 200 ? `${input.body.slice(0, 200)}…` : input.body,
          entityType: "task",
          entityId: taskId
        })
      );
    }
    // Упоминания `@имя` (задание 12.3): люди получают адресное уведомление, агенты — событие в
    // своей очереди. Исполнитель уже получил уведомление о комментарии выше, второй раз не шлём.
    await this.mentions.deliver({
      workspaceId,
      actorId: userId,
      body: input.body,
      entityType: "task",
      entityId: taskId,
      entityLabel: `задаче «${taskTitle}»`,
      notificationKind: "task_comment",
      policyKind: "task",
      eventKeyPrefix: `mention:task_comment:${comment.id}`,
      excludeUserIds: recipientId ? [recipientId] : []
    });
    return toDto(comment, userId);
  }

  async update(userId: string, workspaceId: string, taskId: string, commentId: string, input: UpdateTaskCommentInput): Promise<TaskComment> {
    const comment = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await this.assertOwnedCommentTx(tx, workspaceId, taskId, commentId, userId);
      return tx.taskComment.update({
        where: { id: existing.id },
        data: { body: input.body, editedAt: new Date() },
        include: { author: { select: { id: true, name: true } } }
      });
    });
    return toDto(comment, userId);
  }

  async remove(userId: string, workspaceId: string, taskId: string, commentId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await this.assertOwnedCommentTx(tx, workspaceId, taskId, commentId, userId);
      await tx.taskComment.delete({ where: { id: existing.id } });
    });
  }

  private async assertTaskTx(tx: Prisma.TransactionClient, workspaceId: string, taskId: string) {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task || task.workspaceId !== workspaceId) throw new NotFoundException("Задача не найдена");
    return task;
  }

  /** Loads the comment and checks both scoping (task/workspace) and authorship in one place. */
  private async assertOwnedCommentTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskId: string,
    commentId: string,
    userId: string
  ): Promise<TaskCommentRow> {
    const comment = await tx.taskComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.workspaceId !== workspaceId || comment.taskId !== taskId) {
      throw new NotFoundException("Комментарий не найден");
    }
    // Only the author may edit/delete — no owner/lead moderation override
    // (see class doc comment). A 403, not a 404, so the UI can say why.
    if (comment.userId !== userId) {
      throw new ForbiddenException("Редактировать или удалять можно только свой комментарий");
    }
    return comment;
  }
}

function toDto(row: CommentWithAuthor, viewerId: string): TaskComment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    taskId: row.taskId,
    userId: row.userId,
    authorName: row.author.name,
    mine: row.userId === viewerId,
    body: row.body,
    editedAt: row.editedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
