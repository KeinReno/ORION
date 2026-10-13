import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AgentTokensService, type AgentContext } from "./agent-tokens.service";

export type AgentRequest = { headers: Record<string, string | string[] | undefined>; agent?: AgentContext };

/** Authenticates `Authorization: Bearer orion_agt_…` and attaches `request.agent`. A user JWT is not accepted here. */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly tokens: AgentTokensService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const secret = value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
    const agent = secret ? await this.tokens.authenticate(secret) : null;
    if (!agent) throw new UnauthorizedException("Недействительный токен агента");
    request.agent = agent;
    return true;
  }
}
