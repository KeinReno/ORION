import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  captureInboxInputSchema,
  processInboxInputSchema,
  type CaptureInboxInput,
  type InboxItem,
  type InboxList,
  type ProcessInboxInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { InboxService } from "./inbox.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("history") history?: string): Promise<InboxList> {
    return this.inbox.list(user.userId, workspaceId, history === "true");
  }

  @Post()
  capture(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(captureInboxInputSchema)) body: CaptureInboxInput): Promise<InboxItem> {
    return this.inbox.capture(user.userId, workspaceId, body);
  }

  @Post(":itemId/process")
  process(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("itemId") itemId: string, @Body(new ZodValidationPipe(processInboxInputSchema)) body: ProcessInboxInput): Promise<InboxItem> {
    return this.inbox.process(user.userId, workspaceId, itemId, body);
  }

  @Delete(":itemId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("itemId") itemId: string): Promise<void> {
    return this.inbox.remove(user.userId, workspaceId, itemId);
  }
}
