import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createHabitInputSchema,
  habitDayKeySchema,
  toggleHabitInputSchema,
  updateHabitInputSchema,
  type CreateHabitInput,
  type Habit,
  type HabitEntry,
  type ToggleHabitInput,
  type ToggleHabitResult,
  type UpdateHabitInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { HabitsService } from "./habits.service";

/**
 * `habits/entries` is declared before the `:habitId` routes so the literal wins.
 */
@RequireModule("habits")
@Controller("workspaces/:workspaceId/habits")
export class HabitsController {
  constructor(private readonly habits: HabitsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("includeArchived") includeArchived?: string,
    // Validated, not guessed: a malformed day would silently shift the streak
    // window, so it's a 400 instead.
    @Query("today", new ZodValidationPipe(habitDayKeySchema.optional())) today?: string
  ): Promise<Habit[]> {
    return this.habits.list(user.userId, workspaceId, { includeArchived: includeArchived === "true", today });
  }

  @Get("entries")
  entries(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ): Promise<HabitEntry[]> {
    return this.habits.entries(user.userId, workspaceId, { from, to });
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createHabitInputSchema)) body: CreateHabitInput
  ): Promise<Habit> {
    return this.habits.create(user.userId, workspaceId, body);
  }

  @Patch(":habitId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("habitId") habitId: string,
    @Body(new ZodValidationPipe(updateHabitInputSchema)) body: UpdateHabitInput
  ): Promise<Habit> {
    return this.habits.update(user.userId, workspaceId, habitId, body);
  }

  /** Archiving, not deletion — the tick history stays (see HabitsService.archive). */
  @Delete(":habitId")
  archive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("habitId") habitId: string
  ): Promise<Habit> {
    return this.habits.archive(user.userId, workspaceId, habitId);
  }

  @Post(":habitId/toggle")
  toggle(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("habitId") habitId: string,
    @Body(new ZodValidationPipe(toggleHabitInputSchema)) body: ToggleHabitInput
  ): Promise<ToggleHabitResult> {
    return this.habits.toggle(user.userId, workspaceId, habitId, body);
  }
}
