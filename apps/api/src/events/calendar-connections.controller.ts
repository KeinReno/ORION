import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { calendarConnectionInputSchema, type CalendarConnection, type CalendarConnectionInput } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { CalendarConnectionsService } from "./calendar-connections.service";

@RequireModule("calendar")
@RequirePlugin("calendar-external")
@Controller("workspaces/:workspaceId/calendar-connections")
export class CalendarConnectionsController {
  constructor(private readonly connections: CalendarConnectionsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<CalendarConnection[]> {
    return this.connections.list(user.userId, workspaceId);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Body(new ZodValidationPipe(calendarConnectionInputSchema)) body: CalendarConnectionInput): Promise<CalendarConnection> {
    return this.connections.create(user.userId, workspaceId, body);
  }

  @Patch(":id")
  update(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("id") id: string, @Body(new ZodValidationPipe(calendarConnectionInputSchema)) body: CalendarConnectionInput): Promise<CalendarConnection> {
    return this.connections.update(user.userId, workspaceId, id, body);
  }

  @Post(":id/sync")
  sync(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("id") id: string): Promise<{ imported: number }> {
    return this.connections.sync(user.userId, workspaceId, id);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("id") id: string): Promise<void> {
    return this.connections.remove(user.userId, workspaceId, id);
  }
}
