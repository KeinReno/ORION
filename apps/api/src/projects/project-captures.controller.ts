import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createProjectCaptureInputSchema,
  createProjectProblemInputSchema,
  updateProjectCaptureInputSchema,
  type CreateProjectCaptureInput,
  type CreateProjectProblemInput,
  type ProjectCapture,
  type UpdateProjectCaptureInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { RequirePlugin } from "../plugins/require-plugin";
import { ProjectCapturesService } from "./project-captures.service";

@RequireModule("projects")
@RequirePlugin("projects-ideas")
@Controller("workspaces/:workspaceId/projects/:projectId/ideas")
export class ProjectIdeasController {
  constructor(private readonly captures: ProjectCapturesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string
  ): Promise<ProjectCapture[]> {
    return this.captures.list(user.userId, workspaceId, projectId, "idea");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectCaptureInputSchema)) body: CreateProjectCaptureInput
  ): Promise<ProjectCapture> {
    return this.captures.create(user.userId, workspaceId, projectId, "idea", body);
  }

  @Patch(":captureId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string,
    @Body(new ZodValidationPipe(updateProjectCaptureInputSchema)) body: UpdateProjectCaptureInput
  ): Promise<ProjectCapture> {
    return this.captures.update(user.userId, workspaceId, projectId, captureId, "idea", body);
  }

  @Delete(":captureId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string
  ): Promise<void> {
    return this.captures.remove(user.userId, workspaceId, projectId, captureId, "idea");
  }

  @Post(":captureId/promote")
  promote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string
  ): Promise<ProjectCapture> {
    return this.captures.promote(user.userId, workspaceId, projectId, captureId, "idea");
  }
}

@RequireModule("projects")
@RequirePlugin("projects-problems")
@Controller("workspaces/:workspaceId/projects/:projectId/problems")
export class ProjectProblemsController {
  constructor(private readonly captures: ProjectCapturesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string
  ): Promise<ProjectCapture[]> {
    return this.captures.list(user.userId, workspaceId, projectId, "problem");
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(createProjectProblemInputSchema)) body: CreateProjectProblemInput
  ): Promise<ProjectCapture> {
    return this.captures.create(user.userId, workspaceId, projectId, "problem", body);
  }

  @Patch(":captureId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string,
    @Body(new ZodValidationPipe(updateProjectCaptureInputSchema)) body: UpdateProjectCaptureInput
  ): Promise<ProjectCapture> {
    return this.captures.update(user.userId, workspaceId, projectId, captureId, "problem", body);
  }

  @Delete(":captureId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string
  ): Promise<void> {
    return this.captures.remove(user.userId, workspaceId, projectId, captureId, "problem");
  }

  @Post(":captureId/promote")
  promote(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("captureId") captureId: string
  ): Promise<ProjectCapture> {
    return this.captures.promote(user.userId, workspaceId, projectId, captureId, "problem");
  }
}
