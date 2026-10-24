import { Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { PublicationContent, PublicationSource } from "@orion/shared-types";
import { PublicationRegistry } from "../shared/publication-registry";
import { publicationText, type PublicationAdapter } from "../shared/publication-contracts";
@Injectable()
export class KnowledgePublicationAdapter implements PublicationAdapter, OnModuleInit {
  readonly kind = "knowledge" as const;
  constructor(private readonly registry: PublicationRegistry) {}
  onModuleInit() { this.registry.register(this); }
  async read(tx: Prisma.TransactionClient, source: PublicationSource) {
    const item = await tx.knowledgeItem.findFirst({ where: { id: source.sourceId, workspaceId: source.sourceWorkspaceId } });
    if (!item) throw new NotFoundException("Исходный материал недоступен");
    return { revision: item.revision, content: { title: publicationText(item.title), text: source.includeText ? publicationText(item.body) : "" } };
  }
  async copy(tx: Prisma.TransactionClient, userId: string, workspaceId: string, content: PublicationContent) {
    const item = await tx.knowledgeItem.create({ data: { workspaceId, createdBy: userId, title: content.title, body: content.text, visibility: "private", status: "draft" } });
    return item.id;
  }
}
