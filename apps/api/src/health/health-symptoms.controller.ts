import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createHealthSymptomInputSchema,
  updateHealthSymptomInputSchema,
  type CreateHealthSymptomInput,
  type HealthSummary,
  type HealthSymptom,
  type UpdateHealthSymptomInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { HealthSummaryService } from "./health-summary.service";
import { HealthSymptomsService } from "./health-symptoms.service";

@RequireModule("health")
@Controller("workspaces/:workspaceId/health/subjects/:subjectId")
export class HealthSymptomsController {
  constructor(
    private readonly symptoms: HealthSymptomsService,
    private readonly summary: HealthSummaryService
  ) {}

  @Get("symptoms")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string, @Query("from") from?: string): Promise<HealthSymptom[]> {
    if (from && Number.isNaN(new Date(from).getTime())) throw new BadRequestException("from: некорректная дата");
    return this.symptoms.list(user.userId, workspaceId, subjectId, from || undefined);
  }

  @Post("symptoms")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthSymptomInputSchema)) body: CreateHealthSymptomInput
  ): Promise<HealthSymptom> {
    return this.symptoms.create(user.userId, workspaceId, subjectId, body);
  }

  @Patch("symptoms/:symptomId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("symptomId") symptomId: string,
    @Body(new ZodValidationPipe(updateHealthSymptomInputSchema)) body: UpdateHealthSymptomInput
  ): Promise<HealthSymptom> {
    return this.symptoms.update(user.userId, workspaceId, subjectId, symptomId, body);
  }

  @Delete("symptoms/:symptomId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string, @Param("symptomId") symptomId: string): Promise<void> {
    return this.symptoms.remove(user.userId, workspaceId, subjectId, symptomId);
  }

  /** Всё для карточки врача и экстренной карточки одним ответом. */
  @Get("summary")
  getSummary(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<HealthSummary> {
    return this.summary.summary(user.userId, workspaceId, subjectId);
  }
}
