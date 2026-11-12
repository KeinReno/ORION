import { Body, Controller, Param, Post } from "@nestjs/common";
import { bulkTaskRequestSchema, type BulkTaskRequest, type BulkTaskResult } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { TasksBulkService } from "./tasks-bulk.service";

/**
 * Массовые операции (задание 02, 2.2). Путь статический (`tasks/bulk`), поэтому
 * он объявлен здесь, а не в `TasksController` с `:taskId`.
 */
@RequireModule("tasks")
@Controller("workspaces/:workspaceId/tasks/bulk")
export class TasksBulkController {
  constructor(private readonly bulk: TasksBulkService) {}

  @Post()
  @RequirePermission("tasks.task.update")
  run(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(bulkTaskRequestSchema)) body: BulkTaskRequest
  ): Promise<BulkTaskResult> {
    return this.bulk.run(user.userId, workspaceId, body);
  }
}
