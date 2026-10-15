import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import {
  createHealthMeasurementInputSchema,
  healthMeasurementKindSchema,
  putHealthTargetInputSchema,
  type CreateHealthMeasurementInput,
  type HealthMeasurement,
  type HealthMeasurementKind,
  type HealthTarget,
  type PutHealthTargetInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { HealthMeasurementsService } from "./health-measurements.service";

function kindOf(value: string): HealthMeasurementKind {
  const parsed = healthMeasurementKindSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException("Неизвестный вид показателя");
  return parsed.data;
}

function isoOrUndefined(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (Number.isNaN(new Date(value).getTime())) throw new BadRequestException(`${name}: некорректная дата`);
  return value;
}

@RequireModule("health")
@Controller("workspaces/:workspaceId/health/subjects/:subjectId")
export class HealthMeasurementsController {
  constructor(private readonly measurements: HealthMeasurementsService) {}

  @Get("measurements")
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Query("kind") kind?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ): Promise<HealthMeasurement[]> {
    return this.measurements.list(user.userId, workspaceId, subjectId, { kind: kind ? kindOf(kind) : undefined, from: isoOrUndefined(from, "from"), to: isoOrUndefined(to, "to") });
  }

  @Post("measurements")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthMeasurementInputSchema)) body: CreateHealthMeasurementInput
  ): Promise<HealthMeasurement> {
    return this.measurements.create(user.userId, workspaceId, subjectId, body);
  }

  @Delete("measurements/:measurementId")
  @HttpCode(204)
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("measurementId") measurementId: string
  ): Promise<void> {
    return this.measurements.remove(user.userId, workspaceId, subjectId, measurementId);
  }

  @Get("measurement-targets")
  targets(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<HealthTarget[]> {
    return this.measurements.listTargets(user.userId, workspaceId, subjectId);
  }

  @Put("measurement-targets/:kind")
  putTarget(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("kind") kind: string,
    @Body(new ZodValidationPipe(putHealthTargetInputSchema)) body: PutHealthTargetInput
  ): Promise<HealthTarget> {
    return this.measurements.putTarget(user.userId, workspaceId, subjectId, kindOf(kind), body);
  }

  @Delete("measurement-targets/:kind")
  @HttpCode(204)
  removeTarget(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string, @Param("kind") kind: string): Promise<void> {
    return this.measurements.removeTarget(user.userId, workspaceId, subjectId, kindOf(kind));
  }
}
