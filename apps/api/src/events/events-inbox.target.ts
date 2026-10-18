import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InboxTargetRegistry } from "../inbox/inbox-target.registry";
import type { InboxTarget, InboxTargetContext } from "../inbox/inbox-target";

/** G19: «входящее → событие» живёт в модуле календаря. */
@Injectable()
export class EventInboxTarget implements InboxTarget, OnModuleInit {
  readonly kind = "event" as const;
  readonly componentId = "calendar" as const;

  constructor(private readonly registry: InboxTargetRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async createTx(tx: Prisma.TransactionClient, ctx: InboxTargetContext): Promise<string> {
    // Без срока событие стартует «сейчас» и длится получаса — как и раньше при разборе входящих.
    const start = ctx.dueAt ? new Date(ctx.dueAt) : new Date();
    const event = await tx.event.create({
      data: {
        workspaceId: ctx.workspaceId,
        title: ctx.title,
        description: ctx.body,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        projectId: ctx.projectId,
        tz: "UTC"
      }
    });
    return event.id;
  }
}
