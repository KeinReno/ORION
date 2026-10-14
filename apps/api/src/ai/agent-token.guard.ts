import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { AgentTokensService, type AgentContext } from "./agent-tokens.service";
import { resolveAiRateLimit, SlidingWindowLimiter } from "./rate-limiter";

export type AgentRequest = { headers: Record<string, string | string[] | undefined>; agent?: AgentContext };

/**
 * Authenticates `Authorization: Bearer orion_agt_…` and attaches `request.agent`. A user JWT is not accepted here.
 * After authentication every call spends from a per-token sliding-window budget
 * (`ORION_AI_RATE_LIMIT`, default 120/min); an exhausted budget is a 429 with `Retry-After`, audited like any other refusal.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  private readonly limiter = new SlidingWindowLimiter(resolveAiRateLimit());

  constructor(private readonly tokens: AgentTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AgentRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const secret = value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
    const agent = secret ? await this.tokens.authenticate(secret) : null;
    if (!agent) throw new UnauthorizedException("Недействительный токен агента");

    const decision = this.limiter.consume(agent.tokenId);
    if (!decision.allowed) {
      this.limiter.sweep();
      await this.tokens.record(agent, "rate_limited", null, HttpStatus.TOO_MANY_REQUESTS);
      http.getResponse<{ setHeader(name: string, value: string): void }>().setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(`Слишком много запросов: повторите через ${decision.retryAfterSeconds} с`, HttpStatus.TOO_MANY_REQUESTS);
    }
    request.agent = agent;
    return true;
  }
}
