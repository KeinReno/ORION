import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  workflowEdgeSchema,
  workflowNodeSchema,
  workflowStatusSchema,
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  type Workflow,
  type WorkflowSummary
} from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/**
 * Workbench (11.4): пользовательские процессы. Граф целиком — пользовательские данные
 * пространства (jsonb), одна запись на процесс; запись процесса заменяет граф
 * транзакционно, поэтому параллельная вкладка не оставляет половину правки.
 */
@Injectable()
export class DevelopmentWorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<WorkflowSummary[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.developmentWorkflow.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" }
      });
      return rows.map(toSummaryDto);
    });
  }

  async create(userId: string, workspaceId: string, input: CreateWorkflowInput): Promise<{ id: string }> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await tx.developmentWorkflow.create({
        data: {
          workspaceId,
          name: input.name,
          description: input.description ?? "",
          nodes: [],
          edges: []
        }
      });
      return { id: row.id };
    });
  }

  async get(userId: string, workspaceId: string, workflowId: string): Promise<Workflow> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await this.requireWorkflowTx(tx, workspaceId, workflowId);
      return toWorkflowDto(row);
    });
  }

  async update(userId: string, workspaceId: string, workflowId: string, input: UpdateWorkflowInput): Promise<Workflow> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const row = await this.requireWorkflowTx(tx, workspaceId, workflowId);
      const saved = await tx.developmentWorkflow.update({
        where: { id: row.id },
        data: {
          name: input.name ?? row.name,
          description: input.description ?? row.description,
          status: input.status ?? row.status,
          nodes: input.nodes as unknown as Prisma.InputJsonValue,
          edges: input.edges as unknown as Prisma.InputJsonValue
        }
      });
      return toWorkflowDto(saved);
    });
  }

  async remove(userId: string, workspaceId: string, workflowId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.requireWorkflowTx(tx, workspaceId, workflowId);
      await tx.developmentWorkflow.delete({ where: { id: workflowId } });
    });
  }

  private async requireWorkflowTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    workflowId: string
  ): Promise<{ id: string; name: string; description: string; status: string; nodes: Prisma.JsonValue; edges: Prisma.JsonValue; createdAt: Date; updatedAt: Date }> {
    const row = await tx.developmentWorkflow.findFirst({ where: { id: workflowId, workspaceId } });
    if (!row) throw new NotFoundException("Процесс не найден");
    return row;
  }
}

type WorkflowRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  nodes: Prisma.JsonValue;
  edges: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export function toSummaryDto(row: WorkflowRow): WorkflowSummary {
  const status = workflowStatusSchema.safeParse(row.status);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: status.success ? status.data : "draft",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toWorkflowDto(row: WorkflowRow): Workflow {
  const nodes = workflowNodeSchema.array().safeParse(row.nodes);
  const edges = workflowEdgeSchema.array().safeParse(row.edges);
  return {
    ...toSummaryDto(row),
    nodes: nodes.success ? nodes.data : [],
    edges: edges.success ? edges.data : []
  };
}
