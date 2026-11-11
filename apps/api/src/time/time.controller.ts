import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createTimeEntryInputSchema,
  setTimePlanInputSchema,
  startTimerInputSchema,
  stopTimerInputSchema,
  switchTimerInputSchema,
  updateTimeEntryInputSchema,
  type CreateTimeEntryInput,
  type SetTimePlanInput,
  type StartTimerInput,
  type StopTimerInput,
  type SwitchTimerInput,
  type SwitchTimerResult,
  type TimeAnalytics,
  type TimeEntry,
  type TimeEntryPage,
  type TimePlan,
  type TimeSummary,
  type UpdateTimeEntryInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequirePermission } from "../common/require-permission";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TimeService } from "./time.service";
import { TimeAnalyticsService } from "./time-analytics.service";

/**
 * Route order matters: `time/running`, `time/start`, `time/pause`, `time/resume`,
 * `time/switch`, `time/analytics` and `time/plans` are declared before the
 * `:entryId` routes so the literals win.
 */
@RequireModule("time")
@Controller("workspaces/:workspaceId/time")
export class TimeController {
  constructor(
    private readonly time: TimeService,
    private readonly analytics: TimeAnalyticsService
  ) {}

  @Get()
  @RequirePermission("time.entry.read")
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
  @RequirePermission("time.entry.read")
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

  /** План/факт (задание 04): факт по проектам и задачам, оценки задач и недельный план. */
  @Get("analytics")
  @RequirePermission("time.entry.read")
  analyticsView(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("projectId") projectId?: string
  ): Promise<TimeAnalytics> {
    return this.analytics.analytics(user.userId, workspaceId, { from, to, projectId });
  }

  @Get("plans")
  @RequirePermission("time.plan.manage")
  plans(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("fromWeek") fromWeek?: string,
    @Query("toWeek") toWeek?: string
  ): Promise<TimePlan[]> {
    return this.analytics.plans(user.userId, workspaceId, { fromWeek, toWeek });
  }

  @Put("plans/:week")
  @RequirePermission("time.plan.manage")
  setPlan(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("week") week: string,
    @Body(new ZodValidationPipe(setTimePlanInputSchema)) body: SetTimePlanInput
  ): Promise<TimePlan> {
    return this.analytics.setPlan(user.userId, workspaceId, week, body);
  }

  @Delete("plans/:week")
  @HttpCode(204)
  @RequirePermission("time.plan.manage")
  async removePlan(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("week") week: string
  ): Promise<void> {
    await this.analytics.removePlan(user.userId, workspaceId, week);
  }

  @Get("running")
  @RequirePermission("time.entry.read")
  running(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TimeEntry | null> {
    return this.time.running(user.userId, workspaceId);
  }

  @Post("start")
  @RequirePermission("time.entry.create")
  start(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(startTimerInputSchema)) body: StartTimerInput
  ): Promise<TimeEntry> {
    return this.time.start(user.userId, workspaceId, body);
  }

  /** Переключение на другую задачу: закрывает текущий таймер и открывает новый. */
  @Post("switch")
  @RequirePermission("time.entry.create")
  switchTimer(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(switchTimerInputSchema)) body: SwitchTimerInput
  ): Promise<SwitchTimerResult> {
    return this.time.switchTimer(user.userId, workspaceId, body);
  }

  @Post("stop")
  @RequirePermission("time.entry.update")
  stop(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(stopTimerInputSchema)) body: StopTimerInput
  ): Promise<TimeEntry> {
    return this.time.stop(user.userId, workspaceId, body);
  }

  @Post("pause")
  @RequirePermission("time.entry.update")
  pause(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TimeEntry> {
    return this.time.pause(user.userId, workspaceId);
  }

  @Post("resume")
  @RequirePermission("time.entry.update")
  resume(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TimeEntry> {
    return this.time.resume(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("time.entry.create")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTimeEntryInputSchema)) body: CreateTimeEntryInput
  ): Promise<TimeEntry> {
    return this.time.create(user.userId, workspaceId, body);
  }

  @Patch(":entryId")
  @RequirePermission("time.entry.update")
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
  @RequirePermission("time.entry.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("entryId") entryId: string
  ): Promise<void> {
    await this.time.remove(user.userId, workspaceId, entryId);
  }
}
