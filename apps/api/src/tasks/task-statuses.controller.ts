import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createTaskStatusInputSchema,
  updateTaskStatusInputSchema,
  type CreateTaskStatusInput,
  type TaskStatusDefinition,
  type UpdateTaskStatusInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TaskStatusesService } from "./task-statuses.service";

/** Пользовательские статусы пространства (задание 02, 2.3). */
@RequireModule("tasks")
@Controller("workspaces/:workspaceId/task-statuses")
export class TaskStatusesController {
  constructor(private readonly statuses: TaskStatusesService) {}

  @Get()
  @RequirePermission("tasks.task.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TaskStatusDefinition[]> {
    return this.statuses.list(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("tasks.status.manage")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTaskStatusInputSchema)) body: CreateTaskStatusInput
  ): Promise<TaskStatusDefinition> {
    return this.statuses.create(user.userId, workspaceId, body);
  }

  @Patch(":statusId")
  @RequirePermission("tasks.status.manage")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("statusId") statusId: string,
    @Body(new ZodValidationPipe(updateTaskStatusInputSchema)) body: UpdateTaskStatusInput
  ): Promise<TaskStatusDefinition> {
    return this.statuses.update(user.userId, workspaceId, statusId, body);
  }

  /** Занятый статус без `confirm=true` отвечает 409 `task_status_in_use`. */
  @Delete(":statusId")
  @RequirePermission("tasks.status.manage")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("statusId") statusId: string,
    @Query("confirm") confirm?: string,
    @Query("reassignToId") reassignToId?: string
  ): Promise<void> {
    return this.statuses.remove(user.userId, workspaceId, statusId, {
      confirm: confirm === "true",
      reassignToId: reassignToId || undefined
    });
  }
}
