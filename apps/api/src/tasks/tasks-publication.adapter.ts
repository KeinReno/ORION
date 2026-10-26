import { Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createTaskInputSchema, type PublicationContent, type PublicationSource, type PublicationRuleConfig, type TaskStatus } from "@orion/shared-types";
import { PublicationRegistry } from "../shared/publication-registry";
import { publicationText, type PublicationAdapter } from "../shared/publication-contracts";
import { TasksService } from "./tasks.service";
@Injectable()
export class TasksPublicationAdapter implements PublicationAdapter, OnModuleInit {
  readonly kind = "task" as const;
  constructor(private readonly registry: PublicationRegistry, private readonly tasks: TasksService) {}
  onModuleInit() { this.registry.register(this); }
  async read(tx: Prisma.TransactionClient, source: PublicationSource) {
    const item = await tx.task.findFirst({ where: { id: source.sourceId, workspaceId: source.sourceWorkspaceId } });
    if (!item) throw new NotFoundException("Исходная задача недоступна");
    return { revision: item.revision, content: { title: publicationText(item.title), text: source.includeText ? publicationText(item.description) : "", status: item.status, ...(source.includeDueAt ? { dueAt: item.dueAt?.toISOString() ?? null } : {}) } };
  }
  async ruleCandidates(tx: Prisma.TransactionClient, config: PublicationRuleConfig, sourceId?: string) {
    const rows = await tx.task.findMany({ where: { workspaceId: config.sourceWorkspaceId,
      ...(sourceId ? { id: sourceId } : {}),
      ...(config.projectIds.length ? { projectId: { in: config.projectIds } } : {}),
      ...(config.statuses.length ? { status: { in: config.statuses } } : {})
    }, orderBy: { id: "asc" }, take: 101 });
    return rows.map(row => ({ sourceId: row.id, revision: row.revision, content: {
      title: publicationText(row.title), text: config.includeText ? publicationText(row.description) : "", status: row.status,
      ...(config.includeDueAt ? { dueAt: row.dueAt?.toISOString() ?? null } : {})
    } }));
  }
  async copy(tx: Prisma.TransactionClient, userId: string, workspaceId: string, content: PublicationContent) {
    const item = await this.tasks.createTx(tx, userId, workspaceId, createTaskInputSchema.parse({ title: content.title, description: content.text, dueAt: content.dueAt }));
    return item.id;
  }
  async changeStatus(tx: Prisma.TransactionClient, publisherId: string, source: PublicationSource, revision: number, status: TaskStatus, actorLabel: string) {
    const result = await this.tasks.updateTx(tx, publisherId, source.sourceWorkspaceId, source.sourceId, { status, expectedRevision: revision }, actorLabel);
    return result.revision;
  }
}
