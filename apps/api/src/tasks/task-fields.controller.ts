import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import {
  createTaskFieldInputSchema,
  setTaskFieldValuesInputSchema,
  updateTaskFieldInputSchema,
  type CreateTaskFieldInput,
  type SetTaskFieldValuesInput,
  type TaskFieldDefinition,
  type TaskFieldValueMap,
  type UpdateTaskFieldInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TaskFieldsService } from "./task-fields.service";

/** Пользовательские поля задач и их значения (задание 02, 2.3). */
@RequireModule("tasks")
@Controller("workspaces/:workspaceId/task-fields")
export class TaskFieldsController {
  constructor(private readonly fields: TaskFieldsService) {}

  @Get()
  @RequirePermission("tasks.task.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TaskFieldDefinition[]> {
    return this.fields.list(user.userId, workspaceId);
  }

  @Post()
  @RequirePermission("tasks.field.manage")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createTaskFieldInputSchema)) body: CreateTaskFieldInput
  ): Promise<TaskFieldDefinition> {
    return this.fields.create(user.userId, workspaceId, body);
  }

  @Patch(":fieldId")
  @RequirePermission("tasks.field.manage")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("fieldId") fieldId: string,
    @Body(new ZodValidationPipe(updateTaskFieldInputSchema)) body: UpdateTaskFieldInput
  ): Promise<TaskFieldDefinition> {
    return this.fields.update(user.userId, workspaceId, fieldId, body);
  }

  @Delete(":fieldId")
  @RequirePermission("tasks.field.manage")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("fieldId") fieldId: string
  ): Promise<void> {
    return this.fields.remove(user.userId, workspaceId, fieldId);
  }
}

/** Значения полей конкретной задачи — отдельный путь, чтобы не пересекаться с CRUD полей. */
@RequireModule("tasks")
@Controller("workspaces/:workspaceId/task-values")
export class TaskValuesController {
  constructor(private readonly fields: TaskFieldsService) {}

  @Get(":taskId")
  @RequirePermission("tasks.task.read")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string
  ): Promise<TaskFieldValueMap> {
    return this.fields.getValues(user.userId, workspaceId, taskId);
  }

  @Put(":taskId")
  @RequirePermission("tasks.task.update")
  set(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(setTaskFieldValuesInputSchema)) body: SetTaskFieldValuesInput
  ): Promise<TaskFieldValueMap> {
    return this.fields.setValues(user.userId, workspaceId, taskId, body);
  }
}
