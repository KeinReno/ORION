import { ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { agentToolByName, decideAgentModuleOperation, type AgentProposal, type OrionModuleId } from "@orion/shared-types";
import type { Response } from "express";
import { ModulesService } from "../modules/modules.service";
import { AgentModuleProposalsService, type ModuleChangeHandler } from "./agent-module-proposals.service";
import type { AgentRequest } from "./agent-token.guard";
import { AgentTokensService, type AgentContext, type AuditMeta } from "./agent-tokens.service";

/** What a change tool answers: the applied result, or the request a human has to approve (HTTP 202). */
export type ModuleChangeResult = { proposed: false; result: unknown } | { proposed: true; proposal: AgentProposal };

/**
 * Единая обёртка вызова инструмента модуля (G13): разрешение → режим → модуль включён → лимит записи → журнал. Модуль
 * не знает ничего об этом: контроллер передаёт имя инструмента, а разрешение и ответственный модуль берутся из каталога
 * `AGENT_TOOLS`. Чтение и добавление идут через `run`; правка и удаление существующего — через `change`, где режим
 * решает «сразу» (менеджер) или «запрос человеку» (помощник; удаление — всегда запрос).
 */
@Injectable()
export class AgentModuleToolsService {
  constructor(
    private readonly tokens: AgentTokensService,
    private readonly modules: ModulesService,
    private readonly proposals: AgentModuleProposalsService
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

  /** A module's agent controller registers how its change/delete tools describe and apply a change. */
  register(toolName: string, handler: ModuleChangeHandler): void {
    this.proposals.register(toolName, handler);
  }

  /**
   * Change or delete an existing record: a manager does it at once (counted against the write limit), an assistant files
   * a request the human approves in Settings or right in the chat (HTTP 202). Deleting is a request in every mode except
   * «администратор», which removes it now (ADR-0044); an observer and a token with «Никогда: удаление» are refused.
   */
  async change(
    req: AgentRequest,
    res: Response,
    toolName: string,
    targetId: string,
    args: Record<string, unknown>,
    options: { reason?: string; allowDirect?: boolean } = {}
  ): Promise<ModuleChangeResult> {
    const agent = req.agent as AgentContext;
    const tool = agentToolByName(toolName);
    const base: AuditMeta = { module: tool?.moduleId, objectId: targetId };
    const resource = tool?.moduleId ? `${tool.moduleId}:${targetId}` : null;
    try {
      if (!tool?.permission || !tool.moduleId || (tool.effect !== "update" && tool.effect !== "delete" && tool.effect !== "delete_request")) {
        throw new ForbiddenException("Инструмент не объявлен модулем");
      }
      const op = tool.effect === "update" ? "update" : "delete";
      const decision = decideAgentModuleOperation(agent, tool.permission, op);
      if (decision.kind === "deny") throw new ForbiddenException(decision.reason);
      await this.modules.assertEnabled(agent.userId, agent.workspaceId, tool.moduleId as OrionModuleId);
      const handler = this.proposals.handler(toolName);
      // `allowDirect`: the change is what the user just asked for in so many words (a file they sent to the assistant
      // goes to the folder it suggested) — no request to confirm their own instruction. Never for deletion.
      if (decision.kind === "propose" && !(op === "update" && options.allowDirect)) {
        const proposal = await this.proposals.file(agent, toolName, op, targetId, args, options.reason ?? "");
        await this.tokens.record(agent, toolName, resource, HttpStatus.ACCEPTED, {
          ...base,
          summary: `Предложил: ${op === "update" ? "изменить" : "удалить"} ${proposal.targetTitle}`
        });
        res.status(HttpStatus.ACCEPTED);
        return { proposed: true, proposal };
      }
      await this.tokens.assertWriteBudget(agent);
      const snapshot = await this.proposals.snapshot(agent.userId, agent.workspaceId, toolName, targetId);
      const result = await handler.apply(agent.userId, agent.workspaceId, targetId, args);
      await this.tokens.record(agent, toolName, resource, 200, { ...base, summary: `${op === "update" ? "Изменил" : "Удалил"} ${handler.noun} «${snapshot.title}»`, wrote: true });
      return { proposed: false, result };
    } catch (error) {
      await this.tokens.record(agent, toolName, resource, error instanceof HttpException ? error.getStatus() : 500, base);
      throw error;
    }
  }
}
