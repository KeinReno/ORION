import { Body, Controller, Get, OnModuleInit, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  architectMapQuerySchema,
  createArchitectureDiagramInputSchema,
  developmentGitGraphQuerySchema,
  updateArchitectureDiagramInputSchema,
  type ArchitectureDiagram,
  type ArchitectureDiagramSummary,
  type CreateArchitectureDiagramInput,
  type UpdateArchitectureDiagramInput,
  type ArchitectMap,
  type ArchitectMapDiff,
  type ArchitectSnapshotSummary,
  type DevelopmentGitGraph
} from "@orion/shared-types";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AgentChangeRunner } from "../mcp/agent-change-runner";
import { AgentToolRunner } from "../mcp/agent-tool-runner";
import { DevelopmentArchitectService } from "./architect/development-architect.service";
import { DevelopmentArchitectureService } from "./architecture/development-architecture.service";
import { DevelopmentGitService } from "./git/development-git.service";
import type { Response } from "express";

/** `repositoryId` — обязательный параметр инструмента, которого нет в обычном query-контракте графа. */
const gitGraphAgentQuerySchema = developmentGitGraphQuerySchema.extend({ repositoryId: z.string().min(1) });
const architectMapAgentQuerySchema = architectMapQuerySchema.extend({ repositoryId: z.string().min(1) });
const architectDiffAgentQuerySchema = z.object({
  repositoryId: z.string().min(1),
  base: z.string().trim().min(1).max(255),
  target: z.string().trim().min(1).max(255)
});
const architectSnapshotsAgentQuerySchema = z.object({ repositoryId: z.string().min(1) });
const agentArchitectureUpdateSchema = updateArchitectureDiagramInputSchema.extend({ reason: z.string().max(1200).optional() });

/**
 * MCP-доступ инструментов ORION DEV (11.4): `orion_git_graph` и `orion_architect_map` из каталога
 * `AGENT_TOOLS`. Оба — только чтение. `AgentToolRunner.run` проверяет разрешение
 * `orion-dev.development_import.read` (оно должно быть выдано токену), режим токена и включённость
 * модуля, а затем пишет `AgentAuditEntry` на каждый вызов — успешный и неуспешный.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/development")
export class DevelopmentAgentController implements OnModuleInit {
  constructor(
    private readonly git: DevelopmentGitService,
    private readonly architect: DevelopmentArchitectService,
    private readonly architecture: DevelopmentArchitectureService,
    private readonly changes: AgentChangeRunner,
    private readonly tools: AgentToolRunner
  ) {}

  onModuleInit(): void {
    const describe = async (userId: string, workspaceId: string, diagramId: string) => {
      const diagram = await this.architecture.get(userId, workspaceId, diagramId).catch(() => null);
      return diagram ? { title: diagram.name, fields: { description: diagram.description, revision: diagram.revision, nodeCount: diagram.nodeCount, edgeCount: diagram.edgeCount }, labels: { description: "Описание", revision: "Ревизия", nodeCount: "Узлы", edgeCount: "Связи" } } : null;
    };
    this.changes.register("orion_architecture_update", {
      noun: "архитектурную схему",
      describe,
      apply: (userId, workspaceId, diagramId, args) => this.architecture.update(userId, workspaceId, diagramId, updateArchitectureDiagramInputSchema.omit({ expectedRevision: true }).extend({ expectedRevision: updateArchitectureDiagramInputSchema.shape.expectedRevision }).parse(args))
    });
  }

  @Get("architect/diagrams")
  listArchitectureDiagrams(@Req() req: AgentRequest): Promise<ArchitectureDiagramSummary[]> {
    return this.tools.run(req, "orion_architecture_diagrams", agent => this.architecture.list(agent.userId, agent.workspaceId), result => ({ resource: "architect:diagrams", summary: `Список авторских схем архитектуры: ${result.length}` }));
  }

  @Get("architect/diagrams/:diagramId")
  getArchitectureDiagram(@Req() req: AgentRequest, @Param("diagramId") diagramId: string): Promise<ArchitectureDiagram> {
    return this.tools.run(req, "orion_architecture_diagram", agent => this.architecture.get(agent.userId, agent.workspaceId, diagramId), result => ({ resource: `architect:diagram:${diagramId}`, summary: `Прочитал «${result.name}»: узлов ${result.nodeCount}, связей ${result.edgeCount}` }));
  }

  @Post("architect/diagrams")
  createArchitectureDiagram(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createArchitectureDiagramInputSchema)) body: CreateArchitectureDiagramInput): Promise<{ id: string }> {
    return this.tools.run(req, "orion_architecture_create", agent => this.architecture.create(agent.userId, agent.workspaceId, body), result => ({ resource: `architect:diagram:${result.id}`, summary: `Создал архитектурную схему «${body.name}»` }));
  }

  @Patch("architect/diagrams/:diagramId")
  updateArchitectureDiagram(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("diagramId") diagramId: string,
    @Body(new ZodValidationPipe(agentArchitectureUpdateSchema)) body: UpdateArchitectureDiagramInput & { reason?: string }
  ): ReturnType<AgentChangeRunner["change"]> {
    const { reason, ...change } = body as UpdateArchitectureDiagramInput & { reason?: string };
    return this.changes.change(req, res, "orion_architecture_update", diagramId, change, { reason });
  }

  @Get("git/graph")
  graph(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(gitGraphAgentQuerySchema)) query: z.infer<typeof gitGraphAgentQuerySchema>
  ): Promise<DevelopmentGitGraph> {
    return this.tools.run(
      req,
      "orion_git_graph",
      (agent) => this.git.graph(agent.userId, agent.workspaceId, query.repositoryId, query),
      (result) => ({
        resource: `git:${query.repositoryId}`,
        summary: `Прочитал git-граф «${result.repository.name}»: коммитов ${result.commits.length}`
      })
    );
  }

  @Get("architect/map")
  map(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(architectMapAgentQuerySchema)) query: z.infer<typeof architectMapAgentQuerySchema>
  ): Promise<ArchitectMap> {
    return this.tools.run(
      req,
      "orion_architect_map",
      (agent) => this.architect.map(agent.userId, agent.workspaceId, query.repositoryId, query.path, query.ref),
      (result) => ({
        resource: `architect:${query.repositoryId}`,
        summary: `Построил карту «${result.repository.name}»${query.ref ? ` на «${query.ref}»` : ""}: узлов ${result.nodes.length}, связей ${result.edges.length}`
      })
    );
  }

  @Get("architect/diff")
  diff(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(architectDiffAgentQuerySchema)) query: z.infer<typeof architectDiffAgentQuerySchema>
  ): Promise<ArchitectMapDiff> {
    return this.tools.run(
      req,
      "orion_architect_diff",
      (agent) => this.architect.diff(agent.userId, agent.workspaceId, query.repositoryId, query.base, query.target),
      (result) => ({
        resource: `architect:${query.repositoryId}`,
        summary: `Диф ${query.base} → ${query.target}: +${result.addedNodes.length}/−${result.removedNodes.length} узлов, +${result.addedEdges.length}/−${result.removedEdges.length} связей, ~${result.changedNodes.length} изменённых`
      })
    );
  }

  @Get("architect/snapshots")
  snapshots(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(architectSnapshotsAgentQuerySchema)) query: z.infer<typeof architectSnapshotsAgentQuerySchema>
  ): Promise<ArchitectSnapshotSummary[]> {
    return this.tools.run(
      req,
      "orion_architect_snapshots",
      (agent) => this.architect.listSnapshots(agent.userId, agent.workspaceId, query.repositoryId),
      (result) => ({
        resource: `architect:${query.repositoryId}`,
        summary: `Снапшотов карты: ${result.length}`
      })
    );
  }
}
