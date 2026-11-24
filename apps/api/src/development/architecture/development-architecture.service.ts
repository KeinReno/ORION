import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  architectureViewportSchema,
  coerceArchitectureGraph,
  type ArchitectureDiagram,
  type ArchitectureDiagramSummary,
  type CreateArchitectureDiagramInput,
  type UpdateArchitectureDiagramInput
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

@Injectable()
export class DevelopmentArchitectureService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async list(userId: string, workspaceId: string): Promise<ArchitectureDiagramSummary[]> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.developmentArchitectureDiagram.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
      return rows.map(toSummary);
    });
  }

  async create(userId: string, workspaceId: string, input: CreateArchitectureDiagramInput): Promise<{ id: string }> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.developmentArchitectureDiagram.create({ data: { workspaceId, name: input.name, description: input.description ?? "" } });
      return { id: row.id };
    });
  }

  async get(userId: string, workspaceId: string, diagramId: string): Promise<ArchitectureDiagram> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return toDiagram(await this.requireDiagram(tx, workspaceId, diagramId));
    });
  }

  async update(userId: string, workspaceId: string, diagramId: string, input: UpdateArchitectureDiagramInput): Promise<ArchitectureDiagram> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.requireDiagram(tx, workspaceId, diagramId);
      if (current.revision !== input.expectedRevision) throw new ConflictException("Схема уже изменена в другой вкладке. Обновите её перед сохранением.");
      await this.assertRepositoryReferences(tx, workspaceId, input);
      const changed = await tx.developmentArchitectureDiagram.updateMany({
        where: { id: diagramId, workspaceId, revision: input.expectedRevision },
        data: {
          name: input.name,
          description: input.description,
          nodes: input.graph.nodes as unknown as Prisma.InputJsonValue,
          edges: input.graph.edges as unknown as Prisma.InputJsonValue,
          viewport: input.graph.viewport === null ? Prisma.DbNull : input.graph.viewport as Prisma.InputJsonValue,
          revision: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new ConflictException("Схема изменилась во время сохранения. Обновите её и повторите.");
      return toDiagram(await this.requireDiagram(tx, workspaceId, diagramId));
    });
  }

  async remove(userId: string, workspaceId: string, diagramId: string): Promise<void> {
    await this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireDiagram(tx, workspaceId, diagramId);
      await tx.developmentArchitectureDiagram.delete({ where: { id: diagramId } });
    });
  }

  private async requireDiagram(tx: Prisma.TransactionClient, workspaceId: string, diagramId: string) {
    const row = await tx.developmentArchitectureDiagram.findFirst({ where: { id: diagramId, workspaceId } });
    if (!row) throw new NotFoundException("Архитектурная схема не найдена");
    return row;
  }

  private async assertRepositoryReferences(tx: Prisma.TransactionClient, workspaceId: string, input: UpdateArchitectureDiagramInput): Promise<void> {
    const referencedIds = [...new Set(input.graph.nodes.flatMap(node => node.binding?.repositoryId ? [node.binding.repositoryId] : []))];
    if (referencedIds.length === 0) return;
    const repositories = await tx.developmentGitRepository.findMany({ where: { workspaceId, id: { in: referencedIds } }, select: { id: true } });
    const registered = new Set(repositories.map(repository => repository.id));
    const missing = referencedIds.find(id => !registered.has(id));
    if (missing) throw new BadRequestException("Привязка должна указывать на репозиторий, зарегистрированный в этом пространстве.");
  }
}

type DiagramRow = {
  id: string; workspaceId: string; name: string; description: string; nodes: Prisma.JsonValue; edges: Prisma.JsonValue;
  viewport: Prisma.JsonValue | null; revision: number; createdAt: Date; updatedAt: Date;
};

function graphOf(row: Pick<DiagramRow, "nodes" | "edges">) {
  return coerceArchitectureGraph(row.nodes, row.edges);
}

function toSummary(row: Pick<DiagramRow, "id" | "name" | "description" | "nodes" | "edges" | "revision" | "createdAt" | "updatedAt">): ArchitectureDiagramSummary {
  const graph = graphOf(row);
  return {
    id: row.id, name: row.name, description: row.description,
    nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
    revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  };
}

function toDiagram(row: DiagramRow): ArchitectureDiagram {
  const graph = graphOf(row);
  const viewport = row.viewport === null ? null : architectureViewportSchema.nullable().safeParse(row.viewport);
  return {
    ...toSummary(row),
    nodes: graph.nodes,
    edges: graph.edges,
    viewport: row.viewport === null ? null : viewport?.success ? viewport.data : null
  };
}
