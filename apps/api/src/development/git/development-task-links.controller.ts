import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  createTaskCommitLinkInputSchema,
  type CreateTaskCommitLinkInput,
  type TaskCommitLink,
  type TaskTrace
} from "@orion/shared-types";
import { CurrentUser } from "../../common/current-user.decorator";
import { RequirePermission } from "../../common/require-permission";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { RequestUser } from "../../auth/jwt.strategy";
import { RequireModule } from "../../modules/require-module";
import { DevelopmentTaskLinksService } from "./development-task-links.service";

/**
 * Привязки коммитов и путь задачи (11.2).
 *
 * `GET tasks/:id/trace` живёт здесь, а не в TasksController: цепочку собирает development из своих
 * привязок и публичного среза задачи, и задача остаётся владельцем своих данных. Маршрут не
 * пересекается с `GET tasks/:taskId`.
 */
@RequireModule("orion-dev")
@Controller("workspaces/:workspaceId")
export class DevelopmentTaskLinksController {
  constructor(private readonly links: DevelopmentTaskLinksService) {}

  @Get("tasks/:taskId/commit-links")
  @RequirePermission("tasks.task.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("taskId") taskId: string): Promise<TaskCommitLink[]> {
    return this.links.listLinks(user.userId, workspaceId, taskId);
  }

  @Post("tasks/:taskId/commit-links")
  @RequirePermission("tasks.task.update")
  link(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(createTaskCommitLinkInputSchema)) body: CreateTaskCommitLinkInput
  ): Promise<TaskCommitLink> {
    return this.links.linkCommit(user.userId, workspaceId, taskId, body);
  }

  @Delete("tasks/:taskId/commit-links/:linkId")
  @HttpCode(204)
  @RequirePermission("tasks.task.update")
  async unlink(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("taskId") taskId: string,
    @Param("linkId") linkId: string
  ): Promise<void> {
    await this.links.unlinkCommit(user.userId, workspaceId, taskId, linkId);
  }

  @Get("tasks/:taskId/trace")
  @RequirePermission("tasks.task.read")
  trace(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("taskId") taskId: string): Promise<TaskTrace> {
    return this.links.trace(user.userId, workspaceId, taskId);
  }
}
