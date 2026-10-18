import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isPluginEnabled } from "@orion/shared-types";
import { InboxTargetRegistry } from "../inbox/inbox-target.registry";
import type { InboxTarget, InboxTargetContext } from "../inbox/inbox-target";

/** G19: «входящее → задача» живёт в модуле задач; инбокс таблиц задач не трогает. */
@Injectable()
export class TaskInboxTarget implements InboxTarget, OnModuleInit {
  readonly kind = "task" as const;
  readonly componentId = "tasks" as const;

  constructor(private readonly registry: InboxTargetRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async createTx(tx: Prisma.TransactionClient, ctx: InboxTargetContext): Promise<string> {
    // Team workspace: the person triaging their inbox is the one who
    // just decided "this is my task" — assign it to them, or it is missing
    // from the Tasks panel's default «Только мои» view right away (found
    // in the live U01 pass). Self-assignment is allowed for any member.
    const assigneeId = await selfAssigneeTx(tx, ctx.userId, ctx.workspaceId);
    const task = await tx.task.create({
      data: {
        workspaceId: ctx.workspaceId,
        title: ctx.title,
        description: ctx.body,
        dueAt: ctx.dueAt ? new Date(ctx.dueAt) : null,
        projectId: ctx.projectId,
        assigneeId
      }
    });
    return task.id;
  }
}

/** The caller's own member id when the «Команда» plugin is on, else null. */
async function selfAssigneeTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<string | null> {
  const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { pluginOverrides: true } });
  if (!isPluginEnabled(workspace?.pluginOverrides, "team")) return null;
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true }
  });
  return member?.id ?? null;
}
