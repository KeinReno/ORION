import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Header, HttpCode, HttpException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentCaptureInputSchema,
  agentLinkInputSchema,
  renderAgentManual,
  type AgentCaptureInput,
  type AgentCaptureResult,
  type AgentGatewayContext,
  type AgentLink,
  type AgentLinkInput,
  type AgentScope,
  type AgentSearchResponse
} from "@orion/shared-types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AgentGatewayService } from "./agent-gateway.service";
import { AgentTokenGuard, type AgentRequest } from "./agent-token.guard";
import { AgentTokensService, type AgentContext } from "./agent-tokens.service";

/**
 * The Agent Gateway endpoints of `/ai/v1` (TZ-02): `context`, `manual`, `capture`, `search`, `links`. Same contract as
 * the rest of the bridge — authenticate the token, check the scope, run as the token's owner, audit success AND failure.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1")
export class AgentGatewayController {
  constructor(
    private readonly gateway: AgentGatewayService,
    private readonly tokens: AgentTokensService
  ) {}

  /** One call that orients an agent that has never seen ORION. Needs no scope: it only describes what the token already may do. */
  @Get("context")
  context(@Req() req: AgentRequest): Promise<AgentGatewayContext> {
    return this.call(req, null, "context.get", () => null, (a) => this.gateway.context(a));
  }

  /** The Agent Manual as Markdown — generated from the same catalogue as the MCP tools. */
  @Get("manual")
  @Header("Content-Type", "text/markdown; charset=utf-8")
  manual(@Req() req: AgentRequest): Promise<string> {
    return this.call(req, null, "manual.get", () => null, async () => renderAgentManual());
  }

  @Post("capture")
  capture(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(agentCaptureInputSchema)) body: AgentCaptureInput
  ): Promise<AgentCaptureResult> {
    return this.call(req, null, "capture", (result) => `${result.kind}:${result.id}`, (a) => this.gateway.capture(a, body));
  }

  @Get("search")
  search(@Req() req: AgentRequest, @Query("q") q?: string): Promise<AgentSearchResponse> {
    return this.call(req, null, "search", () => null, (a) => {
      if (!q || q.trim().length < 2) throw new BadRequestException("Запрос q — от 2 символов");
      return this.gateway.searchObjects(a, q);
    });
  }

  @Post("links")
  link(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(agentLinkInputSchema)) body: AgentLinkInput
  ): Promise<AgentLink> {
    return this.call(req, "links:write", "links.create", (link) => `link:${link.id}`, (a) => this.gateway.link(a, body));
  }

  @Delete("links/:linkId")
  @HttpCode(204)
  unlink(@Req() req: AgentRequest, @Param("linkId") linkId: string): Promise<void> {
    return this.call(req, "links:write", "links.delete", () => `link:${linkId}`, (a) => this.gateway.unlink(a, linkId));
  }

  private async call<T>(
    req: AgentRequest,
    scope: AgentScope | null,
    action: string,
    resourceOf: (result: T) => string | null,
    fn: (agent: AgentContext) => Promise<T>
  ): Promise<T> {
    const agent = req.agent as AgentContext;
    try {
      if (scope && !agent.scopes.includes(scope)) throw new ForbiddenException(`У токена нет разрешения «${scope}»`);
      // ТЗ-03: наблюдатель только читает. Запись здесь — `capture` и связи (scope `links:write` у `null`-scope capture не виден).
      if (agent.mode === "observer" && (action === "capture" || action.startsWith("links."))) {
        throw new ForbiddenException("Режим «наблюдатель»: запись запрещена");
      }
      const result = await fn(agent);
      await this.tokens.record(agent, action, resourceOf(result), 200);
      return result;
    } catch (error) {
      await this.tokens.record(agent, action, null, error instanceof HttpException ? error.getStatus() : 500);
      throw error;
    }
  }
}
