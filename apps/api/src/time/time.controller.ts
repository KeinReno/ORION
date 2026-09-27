import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createTimeEntryInputSchema,
  startTimerInputSchema,
  stopTimerInputSchema,
  updateTimeEntryInputSchema,
  type CreateTimeEntryInput,
  type StartTimerInput,
  type StopTimerInput,
  type TimeEntry,
  type TimeEntryPage,
  type TimeSummary,
  type UpdateTimeEntryInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TimeService } from "./time.service";

/**
 * Route order matters: `time/running`, `time/start` and `time/stop` are
 * declared before the `:entryId` routes so the literals win.
 */
@RequireModule("time")
@Controller("workspaces/:workspaceId/time")
export class TimeController {
  constructor(private readonly time: TimeService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("taskId") taskId?: string,
    @Query("projectId") projectId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ): Promise<TimeEntryPage> {
    return this.time.list(
      user.userId,
      workspaceId,
      { from, to, taskId, projectId },
      { cursor, limit: limit ? Number(limit) : undefined }
    );
  }

  /**
   * Exact totals for the same filter set `list()` takes — see `TimeService.summary`.
   * Declared before `:entryId` for the same route-order reason as `running`/`start`/`stop`.
   */
  @Get("summary")
  summary(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("taskId") taskId?: string,
    @Query("projectId") projectId?: string
  ): Promise<TimeSummary> {
    return this.time.summary(user.userId, workspaceId, { from, to, taskId, projectId });
  }

  @Get("running")
  running(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TimeEntry | null> {
    return this.time.running(user.userId, workspaceId);
  }

  @Post("start")
  start(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(startTimerInputSchema)) body: StartTimerInput
  ): Promise<TimeEntry> {
    return this.time.start(user.userId, workspaceId, body);
  }

  @Post("stop")
  stop(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(stopTimerInputSchema)) body: StopTimerInput
  ): Promise<TimeEntry> {
    return this.time.stop(user.userId, workspaceId, body);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTimeEntryInputSchema)) body: CreateTimeEntryInput
  ): Promise<TimeEntry> {
    return this.time.create(user.userId, workspaceId, body);
  }

  @Patch(":entryId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("entryId") entryId: string,
    @Body(new ZodValidationPipe(updateTimeEntryInputSchema)) body: UpdateTimeEntryInput
  ): Promise<TimeEntry> {
    return this.time.update(user.userId, workspaceId, entryId, body);
  }

  @Delete(":entryId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("entryId") entryId: string
  ): Promise<void> {
    await this.time.remove(user.userId, workspaceId, entryId);
  }
}
