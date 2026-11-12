import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import {
  setTaskRecurrenceInputSchema,
  type SetTaskRecurrenceInput,
  type TaskRecurrenceRule
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TaskRecurrenceService } from "./tasks-recurrence.service";

/** Рекуррентность задачи (задание 02, 2.1). */
@RequireModule("tasks")
@Controller("workspaces/:workspaceId/tasks/:taskId/recurrence")
export class TasksRecurrenceController {
  constructor(private readonly recurrences: TaskRecurrenceService) {}

  @Get()
  @RequirePermission("tasks.task.read")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<TaskRecurrenceRule | null> {
    return this.recurrences.get(user.userId, workspaceId, taskId);
  }

  @Put()
  @RequirePermission("tasks.recurrence.manage")
  set(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(setTaskRecurrenceInputSchema)) body: SetTaskRecurrenceInput
  ): Promise<TaskRecurrenceRule> {
    return this.recurrences.set(user.userId, workspaceId, taskId, body);
  }

  @Delete()
  @RequirePermission("tasks.recurrence.manage")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<void> {
    return this.recurrences.remove(user.userId, workspaceId, taskId);
  }

  /** Отмена будущего экземпляра: цепочка продолжается со следующей даты. */
  @Post("skip")
  @RequirePermission("tasks.recurrence.manage")
  skip(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<{ nextTaskId: string | null }> {
    return this.recurrences.skip(user.userId, workspaceId, taskId);
  }
}
