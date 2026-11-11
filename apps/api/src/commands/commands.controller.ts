import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  executeCommandInputSchema,
  type CommandDefinition,
  type CommandExecutionResult,
  type ExecuteCommandInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CommandsService } from "./commands.service";

/**
 * Единый вход команд: `GET /commands?workspaceId=` — список для включённых
 * модулей, `POST /commands/:id/execute` — исполнение. Серверная команда
 * выполняется, UI-команда возвращает маршрут-инструкцию.
 */
@UseGuards(JwtAuthGuard)
@Controller("commands")
export class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Get()
  @RequirePermission("core.command.read")
  list(@CurrentUser() user: RequestUser, @Query("workspaceId") workspaceId?: string): Promise<CommandDefinition[]> {
    if (!workspaceId) throw new BadRequestException("Нужен workspaceId");
    return this.commands.list(user.userId, workspaceId);
  }

  @Post(":commandId/execute")
  @RequirePermission("core.command.execute")
  execute(
    @CurrentUser() user: RequestUser,
    @Param("commandId") commandId: string,
    @Body(new ZodValidationPipe(executeCommandInputSchema)) body: ExecuteCommandInput
  ): Promise<CommandExecutionResult> {
    return this.commands.execute(user.userId, body.workspaceId, commandId, body.args);
  }
}
