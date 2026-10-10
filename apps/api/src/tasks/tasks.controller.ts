import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createSavedTaskViewInputSchema,
  createTaskInputSchema,
  createTaskCommentInputSchema,
  updateTaskInputSchema,
  updateTaskCommentInputSchema,
  type CreateSavedTaskViewInput,
  type CreateTaskInput,
  type CreateTaskCommentInput,
  type SavedTaskView,
  type Task,
  type TaskActivity,
  type TaskComment,
  type TaskCommentPage,
  type UpdateTaskInput,
  type UpdateTaskCommentInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TasksService } from "./tasks.service";
import { TaskCommentsService } from "./task-comments.service";
import { RequirePlugin } from "../plugins/require-plugin";
import { TaskActivityService } from "./task-activity.service";

@RequireModule("tasks")
@Controller("workspaces/:workspaceId/tasks")
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly comments: TaskCommentsService,
    private readonly activity: TaskActivityService
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("search") search?: string,
    @Query("assignedToMe") assignedToMe?: string
  ): Promise<Task[]> {
    return this.tasks.list(user.userId, workspaceId, search, assignedToMe === "true");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTaskInputSchema)) body: CreateTaskInput
  ): Promise<Task> {
    return this.tasks.create(user.userId, workspaceId, body);
  }

  @Get("views")
  @RequirePlugin("tasks-saved-views")
  listViews(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<SavedTaskView[]> {
    return this.tasks.listViews(user.userId, workspaceId);
  }

  @Post("views")
  @RequirePlugin("tasks-saved-views")
  createView(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createSavedTaskViewInputSchema)) body: CreateSavedTaskViewInput
  ): Promise<SavedTaskView> {
    return this.tasks.createView(user.userId, workspaceId, body);
  }

  @Delete("views/:viewId")
  @RequirePlugin("tasks-saved-views")
  removeView(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("viewId") viewId: string): Promise<void> {
    return this.tasks.deleteView(user.userId, workspaceId, viewId);
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

  // --- S17 комментарии + журнал -------------------------------------------

  @Get(":taskId/comments")
  @RequirePlugin("tasks-comments")
  listComments(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ): Promise<TaskCommentPage> {
    return this.comments.list(user.userId, workspaceId, taskId, { cursor, limit: limit ? Number(limit) : undefined });
  }

  @Post(":taskId/comments")
  @RequirePlugin("tasks-comments")
  createComment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(createTaskCommentInputSchema)) body: CreateTaskCommentInput
  ): Promise<TaskComment> {
    return this.comments.create(user.userId, workspaceId, taskId, body);
  }

  @Patch(":taskId/comments/:commentId")
  @RequirePlugin("tasks-comments")
  updateComment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string,
    @Body(new ZodValidationPipe(updateTaskCommentInputSchema)) body: UpdateTaskCommentInput
  ): Promise<TaskComment> {
    return this.comments.update(user.userId, workspaceId, taskId, commentId, body);
  }

  @Delete(":taskId/comments/:commentId")
  @RequirePlugin("tasks-comments")
  @HttpCode(204)
  async removeComment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string
  ): Promise<void> {
    await this.comments.remove(user.userId, workspaceId, taskId, commentId);
  }

  @Get(":taskId/activity")
  listActivity(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<TaskActivity[]> {
    return this.activity.list(user.userId, workspaceId, taskId);
  }
}
