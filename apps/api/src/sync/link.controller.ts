import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { pairLinkDeviceInputSchema, type LinkDevice, type LinkPairing, type PairLinkDeviceInput } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LinkService } from "./link.service";

/** ADR-0020: спаренные устройства Orion Link. Ключ пакетов отдаётся только в ответе на спаривание. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/link/devices")
export class LinkController {
  constructor(private readonly link: LinkService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<LinkDevice[]> {
    return this.link.list(user.userId, workspaceId);
  }

  @Post()
  pair(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(pairLinkDeviceInputSchema)) body: PairLinkDeviceInput
  ): Promise<LinkPairing> {
    return this.link.pair(user.userId, workspaceId, body.name);
  }

  @Delete(":linkDeviceId")
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("linkDeviceId") linkDeviceId: string
  ): Promise<LinkDevice> {
    return this.link.revoke(user.userId, workspaceId, linkDeviceId);
  }
}
