import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  INBOX_TARGET_MODULE,
  type CaptureInboxInput,
  type InboxItem,
  type InboxList,
  type ProcessInboxInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { InboxTargetRegistry } from "./inbox-target.registry";
import { WorkspacesService } from "../workspaces/workspaces.service";

@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly targets: InboxTargetRegistry
  ) {}

  /**
   * S15: the response used to be a flat truncated array — `take: N` with no
   * way for the caller to tell "these are all of them" from "there are more
   * we didn't show". `totalCount` is a real `count()` against the same
   * `where`, so the panel can honestly say "первые N из M" instead of
   * implying the visible rows are the whole inbox.
   */
  async list(userId: string, workspaceId: string, history = false): Promise<InboxList> {
    const limit = history ? 100 : 250;
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const where = { workspaceId, ...(history ? {} : { processedAt: null }) };
      const [rows, totalCount] = await Promise.all([
        tx.inboxItem.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
        tx.inboxItem.count({ where })
      ]);
      return { items: rows.map(toDto), totalCount, limit };
    });
  }

  /**
   * An entry filed by an AI agent (Agent Gateway `capture` without a destination). Always an unprocessed `inbox` item
   * marked with the agent's name — a person sorts it. The caller owns the transaction, the membership check and the
   * check that `projectId` belongs to this workspace.
   */
  async createFromAgentTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    input: { title: string; body: string; dueAt: string | null; projectId: string | null; agentName: string }
  ): Promise<{ id: string }> {
    const row = await tx.inboxItem.create({
      data: {
        workspaceId,
        title: input.title,
        body: input.body,
        kind: "inbox",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        projectId: input.projectId,
        createdByAgent: input.agentName
      }
    });
    return { id: row.id };
  }

  async capture(userId: string, workspaceId: string, input: CaptureInboxInput): Promise<InboxItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertProjectTx(tx, userId, workspaceId, input.projectId ?? null);
      const inbox = await tx.inboxItem.create({
        data: {
          workspaceId,
          title: input.title,
          body: input.body,
          kind: input.kind,
          dueAt: input.dueAt ?? null,
          projectId: input.projectId ?? null
        }
      });
      if (input.kind === "inbox") return inbox;
      const targetId = await this.createTargetTx(
        tx,
        userId,
        workspaceId,
        inbox,
        input.kind,
        input.dueAt ?? null,
        input.projectId ?? null
      );
      return tx.inboxItem.update({
        where: { id: inbox.id },
        data: { targetType: input.kind, targetId, processedAt: new Date() }
      });
    });
    return toDto(row);
  }

  /**
   * S21: two concurrent `process()` calls on the same item (two tabs, or a
   * client retry racing its own first request) must create exactly one
   * target (task/note/event) — not two. The barrier is a conditional
   * `updateMany` that atomically *claims* the item by flipping
   * `processedAt` from null under a `WHERE processedAt IS NULL` predicate
   * before any target is created, not an in-process flag: Postgres
   * serializes concurrent UPDATEs of the same row (the second waits for the
   * first to commit, then re-evaluates the predicate and sees 0 rows
   * matched), so this is a real DB-level lock+recheck, not a race window
   * that merely looks closed. A losing caller gets back the winner's
   * already-processed row instead of creating a second target or throwing.
   */
  async process(userId: string, workspaceId: string, itemId: string, input: ProcessInboxInput): Promise<InboxItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const inbox = await tx.inboxItem.findUnique({ where: { id: itemId } });
      if (!inbox || inbox.workspaceId !== workspaceId) throw new NotFoundException("Запись Inbox не найдена");
      if (inbox.processedAt) return inbox;
      await this.assertProjectTx(tx, userId, workspaceId, input.projectId ?? inbox.projectId);

      // Claim first, create the target second. The predicate below is the
      // actual concurrency barrier — the preceding `findUnique` above is
      // only a fast-path read, not something to rely on for correctness.
      const claimedAt = new Date();
      const claim = await tx.inboxItem.updateMany({
        where: { id: itemId, workspaceId, processedAt: null },
        data: { processedAt: claimedAt }
      });
      if (claim.count === 0) {
        // Lost the race: another concurrent call claimed it first (or it
        // was processed between our read above and this update). Return
        // its result instead of creating a duplicate target.
        const winner = await tx.inboxItem.findUniqueOrThrow({ where: { id: itemId } });
        return winner;
      }

      const targetId = await this.createTargetTx(
        tx,
        userId,
        workspaceId,
        inbox,
        input.kind,
        input.dueAt === undefined ? inbox.dueAt : input.dueAt,
        input.projectId === undefined ? inbox.projectId : input.projectId
      );
      return tx.inboxItem.update({
        where: { id: itemId },
        data: { kind: input.kind, targetType: input.kind, targetId }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const item = await tx.inboxItem.findUnique({ where: { id: itemId } });
      if (!item || item.workspaceId !== workspaceId) throw new NotFoundException("Запись Inbox не найдена");
      await tx.inboxItem.delete({ where: { id: itemId } });
    });
  }

  private async createTargetTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    inbox: { title: string; body: string },
    kind: "task" | "note" | "event",
    dueAt: Date | string | null,
    projectId: string | null
  ): Promise<string> {
    await this.modules.assertEnabledTx(tx, userId, workspaceId, INBOX_TARGET_MODULE[kind]);
    // Саму сущность создаёт цель, зарегистрированная модулем-владельцем (G19); инбокс чужих таблиц не трогает.
    const target = this.targets.get(kind);
    if (!target) throw new ConflictException("Цель входящих не зарегистрирована");
    return target.createTx(tx, { userId, workspaceId, title: inbox.title, body: inbox.body, dueAt, projectId });
  }

  private async assertProjectTx(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    projectId: string | null
  ): Promise<void> {
    if (!projectId) return;
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "projects");
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }
}

function toDto(row: {
  id: string; workspaceId: string; title: string; body: string; kind: string; dueAt: Date | null;
  targetType: string | null; targetId: string | null; projectId: string | null; processedAt: Date | null;
  createdByAgent: string | null; createdAt: Date; updatedAt: Date;
}): InboxItem {
  return {
    ...row,
    kind: row.kind as InboxItem["kind"],
    dueAt: row.dueAt?.toISOString() ?? null,
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
