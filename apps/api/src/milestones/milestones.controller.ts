import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createMilestoneInputSchema,
  milestoneReschedulePreviewInputSchema,
  updateMilestoneInputSchema,
  type CreateMilestoneInput,
  type Milestone,
  type MilestoneCascadeImpact,
  type MilestoneReschedulePreviewInput,
  type UpdateMilestoneInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { MilestonesService } from "./milestones.service";

/** Gated by "projects", not a module of its own — a milestone only exists as a project's plan, see docs/HISTORY.md v0.27. */
@RequireModule("projects")
@Controller("workspaces/:workspaceId/milestones")
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("projectId") projectId?: string
  ): Promise<Milestone[]> {
    return this.milestones.list(user.userId, workspaceId, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createMilestoneInputSchema)) body: CreateMilestoneInput
  ): Promise<Milestone> {
    return this.milestones.create(user.userId, workspaceId, body);
  }

  /**
   * S14a — cascade preview. Read-only: returns which OTHER milestones a
   * date edit would push forward (finish-to-start dependents), without
   * writing anything, so the Gantt can show "will also move: …" before the
   * real PATCH below commits it.
   */
  @Post(":milestoneId/reschedule-preview")
  previewReschedule(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("milestoneId") milestoneId: string,
    @Body(new ZodValidationPipe(milestoneReschedulePreviewInputSchema)) body: MilestoneReschedulePreviewInput
  ): Promise<MilestoneCascadeImpact[]> {
    return this.milestones.previewReschedule(user.userId, workspaceId, milestoneId, body);
  }

  @Patch(":milestoneId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("milestoneId") milestoneId: string,
    @Body(new ZodValidationPipe(updateMilestoneInputSchema)) body: UpdateMilestoneInput
  ): Promise<Milestone> {
    return this.milestones.update(user.userId, workspaceId, milestoneId, body);
  }

  @Delete(":milestoneId")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("milestoneId") milestoneId: string
  ): Promise<void> {
    return this.milestones.remove(user.userId, workspaceId, milestoneId);
  }
}
