import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { teamQuerySchema, type TeamEntry, type TeamQuery, type AgentMemberEvent } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { WorkspaceMembersService } from "./members.service";

/**
 * Единый API команды (задание 12.1): люди, приглашённые и агенты в одном списке.
 *
 * Отдельный контроллер, а не расширение `GET /members`: старый маршрут — контракт существующих
 * клиентов (userId у него непустой), а здесь у агентского членства пользователя нет вовсе.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/team")
export class WorkspaceTeamController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  team(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query() query: unknown): Promise<TeamEntry[]> {
    return this.members.team(user.userId, workspaceId, parseTeamQuery(query));
  }

  /** Очередь событий агентского членства: что ему адресовали, пока он не читал. */
  @Get("agents/:memberId/events")
  agentEvents(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string
  ): Promise<AgentMemberEvent[]> {
    return this.members.listAgentEvents(user.userId, workspaceId, memberId);
  }
}

function parseTeamQuery(query: unknown): TeamQuery {
  const parsed = teamQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}
