import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  createCaptureInputSchema,
  listCapturesQuerySchema,
  updateCaptureInputSchema,
  type Capture,
  type CreateCaptureInput,
  type ListCapturesQuery,
  type UpdateCaptureInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CapturesService } from "./captures.service";

/**
 * Universal captures. No `@RequireModule`: a capture can hang on objects of
 * several modules, and the host that shows it decides whether to render.
 * Promoting to a task checks the tasks module itself.
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/captures")
export class CapturesController {
  constructor(private readonly captures: CapturesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(listCapturesQuerySchema)) query: ListCapturesQuery
  ): Promise<Capture[]> {
    return this.captures.list(user.userId, workspaceId, query);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createCaptureInputSchema)) body: CreateCaptureInput
  ): Promise<Capture> {
    return this.captures.create(user.userId, workspaceId, body);
  }

  @Patch(":captureId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("captureId") captureId: string,
    @Body(new ZodValidationPipe(updateCaptureInputSchema)) body: UpdateCaptureInput
  ): Promise<Capture> {
    return this.captures.update(user.userId, workspaceId, captureId, body);
  }

  @Delete(":captureId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("captureId") captureId: string
  ): Promise<void> {
    return this.captures.remove(user.userId, workspaceId, captureId);
  }

  @Post(":captureId/promote")
  promote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("captureId") captureId: string
  ): Promise<Capture> {
    return this.captures.promote(user.userId, workspaceId, captureId);
  }
}
