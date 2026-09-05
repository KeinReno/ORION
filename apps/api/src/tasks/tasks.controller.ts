import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { createTaskInputSchema, updateTaskInputSchema, type CreateTaskInput, type Task, type UpdateTaskInput } from "@orion/shared-types";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { TasksService } from "./tasks.service";

@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<Task[]> {
    return this.tasks.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTaskInputSchema)) body: CreateTaskInput
  ): Promise<Task> {
    return this.tasks.create(user.userId, workspaceId, body);
  }

  @Patch(":taskId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(updateTaskInputSchema)) body: UpdateTaskInput
  ): Promise<Task> {
    return this.tasks.update(user.userId, workspaceId, taskId, body);
  }

  @Delete(":taskId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<void> {
    return this.tasks.remove(user.userId, workspaceId, taskId);
  }
}
