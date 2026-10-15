import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import {
  createHealthAppointmentInputSchema,
  createHealthPreventiveInputSchema,
  createHealthSubjectInputSchema,
  markHealthPreventiveDoneInputSchema,
  putHealthGrantInputSchema,
  updateHealthAppointmentInputSchema,
  updateHealthPreventiveInputSchema,
  updateHealthSubjectInputSchema,
  type CreateHealthAppointmentInput,
  type CreateHealthPreventiveInput,
  type CreateHealthSubjectInput,
  type HealthAppointment,
  type HealthGrant,
  type HealthPreventiveItem,
  type HealthSubject,
  type HealthToday,
  type MarkHealthPreventiveDoneInput,
  type PutHealthGrantInput,
  type UpdateHealthAppointmentInput,
  type UpdateHealthPreventiveInput,
  type UpdateHealthSubjectInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RequireModule } from "../modules/require-module";
import { HealthService } from "./health.service";

@RequireModule("health")
@Controller("workspaces/:workspaceId/health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("today")
  today(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("today") today?: string): Promise<HealthToday> {
    return this.health.today(user.userId, workspaceId, today);
  }

  @Get("subjects")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Query("archived") archived?: string): Promise<HealthSubject[]> {
    return this.health.listSubjects(user.userId, workspaceId, archived === "1" || archived === "true");
  }

  @Post("subjects")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createHealthSubjectInputSchema)) body: CreateHealthSubjectInput
  ): Promise<HealthSubject> {
    return this.health.createSubject(user.userId, workspaceId, body);
  }

  @Patch("subjects/:subjectId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(updateHealthSubjectInputSchema)) body: UpdateHealthSubjectInput
  ): Promise<HealthSubject> {
    return this.health.updateSubject(user.userId, workspaceId, subjectId, body);
  }

  @Delete("subjects/:subjectId")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<void> {
    return this.health.removeSubject(user.userId, workspaceId, subjectId);
  }

  // ------------------------------------------------------------------ grants

  @Get("subjects/:subjectId/grants")
  grants(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<HealthGrant[]> {
    return this.health.listGrants(user.userId, workspaceId, subjectId);
  }

  @Put("subjects/:subjectId/grants/:granteeUserId")
  putGrant(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("granteeUserId") granteeUserId: string,
    @Body(new ZodValidationPipe(putHealthGrantInputSchema)) body: PutHealthGrantInput
  ): Promise<HealthGrant> {
    return this.health.putGrant(user.userId, workspaceId, subjectId, granteeUserId, body);
  }

  @Delete("subjects/:subjectId/grants/:granteeUserId")
  @HttpCode(204)
  removeGrant(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("granteeUserId") granteeUserId: string
  ): Promise<void> {
    return this.health.removeGrant(user.userId, workspaceId, subjectId, granteeUserId);
  }

  // ------------------------------------------------------------ appointments

  @Get("subjects/:subjectId/appointments")
  appointments(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<HealthAppointment[]> {
    return this.health.listAppointments(user.userId, workspaceId, subjectId);
  }

  @Post("subjects/:subjectId/appointments")
  createAppointment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthAppointmentInputSchema)) body: CreateHealthAppointmentInput
  ): Promise<HealthAppointment> {
    return this.health.createAppointment(user.userId, workspaceId, subjectId, body);
  }

  @Patch("subjects/:subjectId/appointments/:appointmentId")
  updateAppointment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("appointmentId") appointmentId: string,
    @Body(new ZodValidationPipe(updateHealthAppointmentInputSchema)) body: UpdateHealthAppointmentInput
  ): Promise<HealthAppointment> {
    return this.health.updateAppointment(user.userId, workspaceId, subjectId, appointmentId, body);
  }

  @Delete("subjects/:subjectId/appointments/:appointmentId")
  @HttpCode(204)
  removeAppointment(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("appointmentId") appointmentId: string
  ): Promise<void> {
    return this.health.removeAppointment(user.userId, workspaceId, subjectId, appointmentId);
  }

  // -------------------------------------------------------------- preventive

  @Get("subjects/:subjectId/preventive")
  preventive(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string, @Param("subjectId") subjectId: string): Promise<HealthPreventiveItem[]> {
    return this.health.listPreventive(user.userId, workspaceId, subjectId);
  }

  @Post("subjects/:subjectId/preventive")
  createPreventive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthPreventiveInputSchema)) body: CreateHealthPreventiveInput
  ): Promise<HealthPreventiveItem> {
    return this.health.createPreventive(user.userId, workspaceId, subjectId, body);
  }

  @Patch("subjects/:subjectId/preventive/:itemId")
  updatePreventive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateHealthPreventiveInputSchema)) body: UpdateHealthPreventiveInput
  ): Promise<HealthPreventiveItem> {
    return this.health.updatePreventive(user.userId, workspaceId, subjectId, itemId, body);
  }

  @Post("subjects/:subjectId/preventive/:itemId/done")
  markDone(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(markHealthPreventiveDoneInputSchema)) body: MarkHealthPreventiveDoneInput
  ): Promise<HealthPreventiveItem> {
    return this.health.markPreventiveDone(user.userId, workspaceId, subjectId, itemId, body);
  }

  @Delete("subjects/:subjectId/preventive/:itemId")
  @HttpCode(204)
  removePreventive(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("subjectId") subjectId: string,
    @Param("itemId") itemId: string
  ): Promise<void> {
    return this.health.removePreventive(user.userId, workspaceId, subjectId, itemId);
  }
}
