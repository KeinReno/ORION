import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { InboxTargetRegistry } from "../inbox/inbox-target.registry";
import type { InboxTarget, InboxTargetContext } from "../inbox/inbox-target";

/** G19: «входящее → заметка» живёт в модуле заметок. */
@Injectable()
export class NoteInboxTarget implements InboxTarget, OnModuleInit {
  readonly kind = "note" as const;
  readonly componentId = "notes" as const;

  constructor(private readonly registry: InboxTargetRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async createTx(tx: Prisma.TransactionClient, ctx: InboxTargetContext): Promise<string> {
    const note = await tx.note.create({
      data: { workspaceId: ctx.workspaceId, title: ctx.title, body: ctx.body, editedAt: new Date(), projectId: ctx.projectId }
    });
    return note.id;
  }
}
