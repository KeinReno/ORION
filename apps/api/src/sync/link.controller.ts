import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import {
  pairLinkDeviceInputSchema,
  rotateLinkKeyInputSchema,
  type LinkDevice,
  type LinkKeyInfo,
  type LinkPairing,
  type PairLinkDeviceInput
} from "@orion/shared-types";
import type { z } from "zod";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { LinkService } from "./link.service";

/** ADR-0020: спаренные устройства Orion Link. Ключ пакетов отдаётся только в ответе на спаривание. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/link")
export class LinkController {
  constructor(private readonly link: LinkService) {}

  @Get("devices")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<LinkDevice[]> {
    return this.link.list(user.userId, workspaceId);
  }

  @Post("devices")
  pair(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(pairLinkDeviceInputSchema)) body: PairLinkDeviceInput
  ): Promise<LinkPairing> {
    return this.link.pair(user.userId, workspaceId, body.name);
  }

  @Delete("devices/:linkDeviceId")
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("linkDeviceId") linkDeviceId: string
  ): Promise<LinkDevice> {
    return this.link.revoke(user.userId, workspaceId, linkDeviceId);
  }

  @Post("rotate-key")
  rotate(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(rotateLinkKeyInputSchema)) body: z.infer<typeof rotateLinkKeyInputSchema>
  ): Promise<LinkKeyInfo> {
    return this.link.rotateKey(user.userId, workspaceId, body.cutOffOld);
  }
}
