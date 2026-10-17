import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createHealthMedicationInputSchema,
  putHealthIntakeInputSchema,
  updateHealthMedicationInputSchema,
  type CreateHealthMedicationInput,
  type HealthDose,
  type HealthMedication,
  type PutHealthIntakeInput,
  type UpdateHealthMedicationInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { HealthMedicationsService } from "./health-medications.service";

@RequireModule("health")
@Controller("workspaces/:workspaceId/health/subjects/:subjectId/medications")
export class HealthMedicationsController {
  constructor(private readonly medications: HealthMedicationsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Query("today") today?: string,
    @Query("archived") archived?: string
  ): Promise<HealthMedication[]> {
    return this.medications.list(user.userId, workspaceId, subjectId, today, archived === "1" || archived === "true");
  }

  /** Объявлен до `:medicationId`: слоты расписания на день (по умолчанию сегодня) с отметками. */
  @Get("schedule")
  schedule(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Query("day") day?: string
  ): Promise<HealthDose[]> {
    return this.medications.schedule(user.userId, workspaceId, subjectId, day);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthMedicationInputSchema)) body: CreateHealthMedicationInput
  ): Promise<HealthMedication> {
    return this.medications.create(user.userId, workspaceId, subjectId, body);
  }

  @Patch(":medicationId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("medicationId") medicationId: string,
    @Body(new ZodValidationPipe(updateHealthMedicationInputSchema)) body: UpdateHealthMedicationInput
  ): Promise<HealthMedication> {
    return this.medications.update(user.userId, workspaceId, subjectId, medicationId, body);
  }

  @Put(":medicationId/intakes")
  @HttpCode(204)
  putIntake(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("medicationId") medicationId: string,
    @Body(new ZodValidationPipe(putHealthIntakeInputSchema)) body: PutHealthIntakeInput
  ): Promise<void> {
    return this.medications.putIntake(user.userId, workspaceId, subjectId, medicationId, body);
  }

  @Delete(":medicationId/intakes")
  @HttpCode(204)
  removeIntake(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("medicationId") medicationId: string,
    @Query("day") day: string,
    @Query("time") time: string
  ): Promise<void> {
    return this.medications.removeIntake(user.userId, workspaceId, subjectId, medicationId, day, time);
  }
}
