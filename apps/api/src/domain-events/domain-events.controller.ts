import { Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import type { DomainEventOutboxStatus } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RequirePermission } from "../common/require-permission";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DomainEventDispatcherService } from "./domain-event-dispatcher.service";

/**
 * Foundation Core (task 01.2): workspace-scoped diagnostics and manual dead-letter replay.
 * The global (all-workspace) counters stay on `GET system/domain-events` and contain no payloads.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/domain-events")
export class DomainEventsController {
  constructor(
    private readonly dispatcher: DomainEventDispatcherService,
    private readonly workspaces: WorkspacesService
  ) {}

  @Get("status")
  @RequirePermission("core.domain_event.manage")
  async status(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<DomainEventOutboxStatus> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    return this.dispatcher.status(workspaceId);
  }

  @Post("deliveries/:deliveryId/replay")
  @HttpCode(204)
  @RequirePermission("core.domain_event.manage")
  async replay(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("deliveryId") deliveryId: string
  ): Promise<void> {
    await this.workspaces.assertMember(user.userId, workspaceId);
    const replayed = await this.dispatcher.replayDelivery(deliveryId, workspaceId);
    if (!replayed) throw new NotFoundException("Упавшая доставка не найдена");
  }
}
