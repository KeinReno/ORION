import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  assignMatrixCellInputSchema,
  createMatrixPresetInputSchema,
  createPlanningBlockInputSchema,
  movePlanningBlockInputSchema,
  rescheduleImpactInputSchema,
  updateMatrixPresetInputSchema,
  updatePlanningBlockInputSchema,
  type AssignMatrixCellInput,
  type AssignMatrixCellResult,
  type CreateMatrixPresetInput,
  type CreatePlanningBlockInput,
  type GanttResult,
  type MatrixPreset,
  type MovePlanningBlockInput,
  type PlanningBlock,
  type PlanningBlockMoveResult,
  type PlanningMatrix,
  type RescheduleImpact,
  type RescheduleImpactInput,
  type UpdateMatrixPresetInput,
  type UpdatePlanningBlockInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { RequirePermission } from "../common/require-permission";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { PlanningBlocksService } from "./planning-blocks.service";
import { PlanningGanttService } from "./planning-gantt.service";
import { PlanningMatrixService } from "./planning-matrix.service";
import { PlanningMatrixPresetsService } from "./planning-matrix-presets.service";

/**
 * Планирование (задание 04). Один ws-скоуп `workspaces/:workspaceId/planning`,
 * как у остальных модулей. Литеральные сегменты (`gantt`, `matrix`, `presets`)
 * объявлены раньше параметрических (`blocks/:blockId`) — порядок важен так же,
 * как в контроллере Time.
 */
@RequireModule("planning")
@Controller("workspaces/:workspaceId/planning")
export class PlanningController {
  constructor(
    private readonly blocks: PlanningBlocksService,
    private readonly gantt: PlanningGanttService,
    private readonly matrix: PlanningMatrixService,
    private readonly presetService: PlanningMatrixPresetsService
  ) {}

  // --- тайм-блоки ----------------------------------------------------------

  @Get("blocks")
  @RequirePermission("planning.block.read")
  listBlocks(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("taskId") taskId?: string,
    @Query("projectId") projectId?: string,
    @Query("state") state?: string
  ): Promise<PlanningBlock[]> {
    return this.blocks.list(user.userId, workspaceId, { from, to, taskId, projectId, state });
  }

  @Post("blocks")
  @RequirePermission("planning.block.create")
  createBlock(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createPlanningBlockInputSchema)) body: CreatePlanningBlockInput
  ): Promise<PlanningBlock> {
    return this.blocks.create(user.userId, workspaceId, body);
  }

  @Get("blocks/:blockId")
  @RequirePermission("planning.block.read")
  readBlock(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string
  ): Promise<PlanningBlock> {
    return this.blocks.get(user.userId, workspaceId, blockId);
  }

  @Patch("blocks/:blockId")
  @RequirePermission("planning.block.update")
  updateBlock(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
    @Body(new ZodValidationPipe(updatePlanningBlockInputSchema)) body: UpdatePlanningBlockInput
  ): Promise<PlanningBlock> {
    return this.blocks.update(user.userId, workspaceId, blockId, body);
  }

  @Post("blocks/:blockId/move")
  @RequirePermission("planning.block.update")
  moveBlock(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
    @Body(new ZodValidationPipe(movePlanningBlockInputSchema)) body: MovePlanningBlockInput
  ): Promise<PlanningBlockMoveResult> {
    return this.blocks.move(user.userId, workspaceId, blockId, body);
  }

  @Post("blocks/:blockId/move-preview")
  @HttpCode(200)
  @RequirePermission("planning.block.update")
  previewBlockMove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
    @Body(new ZodValidationPipe(movePlanningBlockInputSchema)) body: MovePlanningBlockInput
  ): Promise<PlanningBlockMoveResult> {
    return this.blocks.previewMove(user.userId, workspaceId, blockId, body);
  }

  @Delete("blocks/:blockId")
  @HttpCode(204)
  @RequirePermission("planning.block.delete")
  async removeBlock(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string
  ): Promise<void> {
    await this.blocks.remove(user.userId, workspaceId, blockId);
  }

  // --- Гантт и последствия переноса ---------------------------------------

  @Get("gantt")
  @RequirePermission("planning.view.read")
  ganttView(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("projectId") projectId?: string
  ): Promise<GanttResult> {
    if (!projectId) throw new BadRequestException("Укажите projectId — Гантт строится по проекту");
    return this.gantt.gantt(user.userId, workspaceId, projectId);
  }

  /** Только расчёт: изменений в базе нет, даже под action-правами (dry-run). */
  @Post("reschedule-impact")
  @RequirePermission("planning.view.read")
  rescheduleImpact(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(rescheduleImpactInputSchema)) body: RescheduleImpactInput
  ): Promise<RescheduleImpact> {
    return this.gantt.rescheduleImpact(user.userId, workspaceId, body);
  }

  // --- матрица и пресеты ---------------------------------------------------

  @Get("matrix")
  @RequirePermission("planning.view.read")
  matrixView(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("presetId") presetId?: string,
    @Query("projectId") projectId?: string
  ): Promise<PlanningMatrix> {
    return this.matrix.matrix(user.userId, workspaceId, { presetId, projectId });
  }

  @Post("matrix/assign")
  @RequirePermission("planning.block.update")
  assignCell(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(assignMatrixCellInputSchema)) body: AssignMatrixCellInput
  ): Promise<AssignMatrixCellResult> {
    return this.matrix.assign(user.userId, workspaceId, body);
  }

  @Get("presets")
  @RequirePermission("planning.preset.manage")
  listPresets(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<MatrixPreset[]> {
    return this.presetService.list(user.userId, workspaceId);
  }

  @Post("presets")
  @RequirePermission("planning.preset.manage")
  createPreset(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createMatrixPresetInputSchema)) body: CreateMatrixPresetInput
  ): Promise<MatrixPreset> {
    return this.presetService.create(user.userId, workspaceId, body);
  }

  @Patch("presets/:presetId")
  @RequirePermission("planning.preset.manage")
  updatePreset(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("presetId") presetId: string,
    @Body(new ZodValidationPipe(updateMatrixPresetInputSchema)) body: UpdateMatrixPresetInput
  ): Promise<MatrixPreset> {
    return this.presetService.update(user.userId, workspaceId, presetId, body);
  }

  @Delete("presets/:presetId")
  @HttpCode(204)
  @RequirePermission("planning.preset.manage")
  async removePreset(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("presetId") presetId: string
  ): Promise<void> {
    await this.presetService.remove(user.userId, workspaceId, presetId);
  }
}
