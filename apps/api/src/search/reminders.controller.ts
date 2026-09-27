import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createEntityReminderInputSchema, type CreateEntityReminderInput, type EntityReminder } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RemindersService } from "./reminders.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/reminders")
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<EntityReminder[]> {
    return this.reminders.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createEntityReminderInputSchema)) body: CreateEntityReminderInput
  ): Promise<EntityReminder> {
    return this.reminders.create(user.userId, workspaceId, body);
  }

  /** Cancel — the only mutation besides create; there is no free-form edit of `scheduledAt` in this first slice. */
  @Patch(":reminderId")
  cancel(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("reminderId") reminderId: string
  ): Promise<EntityReminder> {
    return this.reminders.cancel(user.userId, workspaceId, reminderId);
  }
}
