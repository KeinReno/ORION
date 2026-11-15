import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  architectMapQuerySchema,
  developmentGitGraphQuerySchema,
  type ArchitectMap,
  type ArchitectMapDiff,
  type ArchitectSnapshotSummary,
  type DevelopmentGitGraph
} from "@orion/shared-types";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AgentToolRunner } from "../mcp/agent-tool-runner";
import { DevelopmentArchitectService } from "./architect/development-architect.service";
import { DevelopmentGitService } from "./git/development-git.service";

/** `repositoryId` — обязательный параметр инструмента, которого нет в обычном query-контракте графа. */
const gitGraphAgentQuerySchema = developmentGitGraphQuerySchema.extend({ repositoryId: z.string().min(1) });
const architectMapAgentQuerySchema = architectMapQuerySchema.extend({ repositoryId: z.string().min(1) });
const architectDiffAgentQuerySchema = z.object({
  repositoryId: z.string().min(1),
  base: z.string().trim().min(1).max(255),
  target: z.string().trim().min(1).max(255)
});
const architectSnapshotsAgentQuerySchema = z.object({ repositoryId: z.string().min(1) });

/**
 * MCP-доступ инструментов ORION DEV (11.4): `orion_git_graph` и `orion_architect_map` из каталога
 * `AGENT_TOOLS`. Оба — только чтение. `AgentToolRunner.run` проверяет разрешение
 * `orion-dev.development_import.read` (оно должно быть выдано токену), режим токена и включённость
 * модуля, а затем пишет `AgentAuditEntry` на каждый вызов — успешный и неуспешный.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/development")
export class DevelopmentAgentController {
  constructor(
    private readonly git: DevelopmentGitService,
    private readonly architect: DevelopmentArchitectService,
    private readonly tools: AgentToolRunner
  ) {}

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
