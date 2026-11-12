import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  goalCanvasAutoInputSchema,
  putGoalCanvasLayoutInputSchema,
  type GoalCanvasAutoInput,
  type GoalCanvasAutoResult,
  type GoalCanvasLayoutResponse,
  type GoalGraph,
  type GoalGraphSearchResult,
  type GoalProgressReport,
  type PutGoalCanvasLayoutInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { GoalCanvasService } from "./goal-canvas.service";

/** 08 — server-side constellation canvas. Same gates as the goal's own controller. */
@RequireModule("projects")
@RequirePlugin("projects-goals")
@Controller("workspaces/:workspaceId/goals")
export class GoalCanvasController {
  constructor(private readonly canvas: GoalCanvasService) {}

  @Get(":goalId/canvas-layout")
  @RequirePermission("projects.project.read")
  async layout(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<GoalCanvasLayoutResponse> {
    const result = await this.canvas.getLayout(user.userId, workspaceId, goalId);
    res.setHeader("ETag", `"${result.layout.revision}"`);
    return result;
  }

  @Put(":goalId/canvas-layout")
  @RequirePermission("projects.project.update")
  async putLayout(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(putGoalCanvasLayoutInputSchema)) body: PutGoalCanvasLayoutInput,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response
  ): Promise<GoalCanvasLayoutResponse> {
    const result = await this.canvas.putLayout(user.userId, workspaceId, goalId, body, ifMatch);
    res.setHeader("ETag", `"${result.layout.revision}"`);
    return result;
  }

  @Post(":goalId/canvas-layout/auto")
  @HttpCode(200)
  @RequirePermission("projects.project.update")
  auto(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Body(new ZodValidationPipe(goalCanvasAutoInputSchema)) body: GoalCanvasAutoInput
  ): Promise<GoalCanvasAutoResult> {
    return this.canvas.autoLayout(user.userId, workspaceId, goalId, body);
  }

  @Get(":goalId/graph")
  @RequirePermission("projects.project.read")
  graph(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("goalId") goalId: string): Promise<GoalGraph> {
    return this.canvas.graph(user.userId, workspaceId, goalId);
  }

  @Get(":goalId/graph/search")
  @RequirePermission("projects.project.read")
  search(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("goalId") goalId: string,
    @Query("q") query = ""
  ): Promise<GoalGraphSearchResult> {
    return this.canvas.search(user.userId, workspaceId, goalId, query);
  }

  @Get(":goalId/progress")
  @RequirePermission("projects.project.read")
  progress(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("goalId") goalId: string): Promise<GoalProgressReport> {
    return this.canvas.progress(user.userId, workspaceId, goalId);
  }
}
