import { ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { agentToolByName, decideAgentModuleOperation, type OrionModuleId } from "@orion/shared-types";
import { ModulesService } from "../modules/modules.service";
import type { AgentRequest } from "./agent-token.guard";
import { AgentTokensService, type AgentContext, type AuditMeta } from "./agent-tokens.service";

/**
 * Единая обёртка вызова инструмента подключаемого модуля (G13): разрешение → режим → модуль включён → лимит записи →
 * журнал. Модуль не знает ничего об этом: контроллер модуля передаёт имя инструмента из своего манифеста, а разрешение
 * и ответственный модуль берутся из каталога, который сгенерирован из того же манифеста.
 */
@Injectable()
export class AgentModuleToolsService {
  constructor(
    private readonly tokens: AgentTokensService,
    private readonly modules: ModulesService
  ) {}

  async run<T>(
    req: AgentRequest,
    toolName: string,
    fn: (agent: AgentContext) => Promise<T>,
    meta: (result: T) => AuditMeta & { resource?: string } = () => ({})
  ): Promise<T> {
    const agent = req.agent as AgentContext;
    const tool = agentToolByName(toolName);
    const base: AuditMeta = { module: tool?.moduleId };
    try {
      if (!tool?.permission || !tool.moduleId || (tool.effect !== "read" && tool.effect !== "create")) {
        throw new ForbiddenException("Инструмент не объявлен модулем");
      }
      const decision = decideAgentModuleOperation(agent, tool.permission, tool.effect);
      if (decision.kind === "deny") throw new ForbiddenException(decision.reason);
      await this.modules.assertEnabled(agent.userId, agent.workspaceId, tool.moduleId as OrionModuleId);
      const writes = tool.effect === "create";
      if (writes) await this.tokens.assertWriteBudget(agent);
      const result = await fn(agent);
      const { resource, ...audit } = meta(result);
      await this.tokens.record(agent, toolName, resource ?? null, 200, { ...base, ...audit, wrote: writes });
      return result;
    } catch (error) {
      await this.tokens.record(agent, toolName, null, error instanceof HttpException ? error.getStatus() : 500, base);
      throw error;
    }
  }
}
