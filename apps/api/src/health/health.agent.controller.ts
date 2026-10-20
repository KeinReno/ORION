import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  agentHealthMeasurementsQuerySchema,
  agentHealthMedicationsQuerySchema,
  agentHealthOverviewQuerySchema,
  agentHealthSymptomsQuerySchema,
  createHealthAppointmentInputSchema,
  createHealthMeasurementInputSchema,
  createHealthSymptomInputSchema,
  putHealthIntakeInputSchema,
  type CreateHealthAppointmentInput,
  type CreateHealthMeasurementInput,
  type CreateHealthSymptomInput,
  type HealthAppointment,
  type HealthDose,
  type HealthMeasurement,
  type HealthMedication,
  type HealthSubject,
  type HealthSummary,
  type HealthSymptom,
  type HealthToday,
  type PutHealthIntakeInput
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HealthMeasurementsService } from "./health-measurements.service";
import { HealthMedicationsService } from "./health-medications.service";
import { HealthSummaryService } from "./health-summary.service";
import { HealthSymptomsService } from "./health-symptoms.service";
import { HealthService } from "./health.service";

/**
 * Инструменты ИИ-агента для модуля «Здоровье» (G13). Всё — от имени человека-владельца токена и его же правами: чужие
 * приватные записи (ADR-0021) агенту не видны так же, как ему самому. Агент записывает наблюдения, визиты и отметки о
 * приёме; дозы и диагнозы не предлагает. Разрешение, режим, включённость модуля, лимит и журнал — в `AgentModuleToolsService`.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/health")
export class HealthAgentController {
  constructor(
    private readonly health: HealthService,
    private readonly summaries: HealthSummaryService,
    private readonly measurements: HealthMeasurementsService,
    private readonly symptoms: HealthSymptomsService,
    private readonly medications: HealthMedicationsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  @Get()
  overview(
    @Req() req: AgentRequest,
    @Query(new ZodValidationPipe(agentHealthOverviewQuerySchema)) query: { today?: string }
  ): Promise<{ subjects: HealthSubject[]; today: HealthToday }> {
    return this.tools.run(req, "orion_health_overview", async (agent) => {
      const [subjects, today] = await Promise.all([
        this.health.listSubjects(agent.userId, agent.workspaceId),
        this.health.today(agent.userId, agent.workspaceId, query.today)
      ]);
      return { subjects, today };
    });
  }

  @Get(":subjectId/summary")
  summary(@Req() req: AgentRequest, @Param("subjectId") subjectId: string): Promise<HealthSummary> {
    return this.tools.run(req, "orion_health_summary", (agent) => this.summaries.summary(agent.userId, agent.workspaceId, subjectId));
  }

  @Get(":subjectId/measurements")
  listMeasurements(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Query(new ZodValidationPipe(agentHealthMeasurementsQuerySchema)) query: { kind?: CreateHealthMeasurementInput["kind"]; from?: string; to?: string }
  ): Promise<HealthMeasurement[]> {
    return this.tools.run(req, "orion_health_measurements", (agent) => this.measurements.list(agent.userId, agent.workspaceId, subjectId, query));
  }

  @Post(":subjectId/measurements")
  addMeasurement(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthMeasurementInputSchema)) body: CreateHealthMeasurementInput
  ): Promise<HealthMeasurement> {
    return this.tools.run(
      req,
      "orion_health_add_measurement",
      (agent) => this.measurements.create(agent.userId, agent.workspaceId, subjectId, body),
      (item) => ({ resource: `health:${item.id}`, summary: `Записал измерение (${body.kind})` })
    );
  }

  @Get(":subjectId/symptoms")
  listSymptoms(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Query(new ZodValidationPipe(agentHealthSymptomsQuerySchema)) query: { from?: string }
  ): Promise<HealthSymptom[]> {
    return this.tools.run(req, "orion_health_symptoms", (agent) => this.symptoms.list(agent.userId, agent.workspaceId, subjectId, query.from));
  }

  @Post(":subjectId/symptoms")
  addSymptom(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthSymptomInputSchema)) body: CreateHealthSymptomInput
  ): Promise<HealthSymptom> {
    return this.tools.run(
      req,
      "orion_health_add_symptom",
      (agent) => this.symptoms.create(agent.userId, agent.workspaceId, subjectId, body),
      (item) => ({ resource: `health:${item.id}`, summary: `Записал симптом «${body.name}»` })
    );
  }

  @Get(":subjectId/appointments")
  listAppointments(@Req() req: AgentRequest, @Param("subjectId") subjectId: string): Promise<HealthAppointment[]> {
    return this.tools.run(req, "orion_health_appointments", (agent) => this.health.listAppointments(agent.userId, agent.workspaceId, subjectId));
  }

  @Post(":subjectId/appointments")
  addAppointment(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Body(new ZodValidationPipe(createHealthAppointmentInputSchema)) body: CreateHealthAppointmentInput
  ): Promise<HealthAppointment> {
    return this.tools.run(
      req,
      "orion_health_add_appointment",
      (agent) => this.health.createAppointment(agent.userId, agent.workspaceId, subjectId, body),
      (item) => ({ resource: `health:${item.id}`, summary: `Записал визит «${body.title}»` })
    );
  }

  @Get(":subjectId/medications")
  listMedications(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Query(new ZodValidationPipe(agentHealthMedicationsQuerySchema)) query: { day?: string }
  ): Promise<{ medications: HealthMedication[]; schedule: HealthDose[] }> {
    return this.tools.run(req, "orion_health_medications", async (agent) => {
      const [medications, schedule] = await Promise.all([
        this.medications.list(agent.userId, agent.workspaceId, subjectId, query.day),
        this.medications.schedule(agent.userId, agent.workspaceId, subjectId, query.day)
      ]);
      return { medications, schedule };
    });
  }

  @Post(":subjectId/medications/:medicationId/intake")
  @HttpCode(200)
  markIntake(
    @Req() req: AgentRequest,
    @Param("subjectId") subjectId: string,
    @Param("medicationId") medicationId: string,
    @Body(new ZodValidationPipe(putHealthIntakeInputSchema)) body: PutHealthIntakeInput
  ): Promise<{ ok: true }> {
    return this.tools.run(
      req,
      "orion_health_mark_intake",
      async (agent) => {
        await this.medications.putIntake(agent.userId, agent.workspaceId, subjectId, medicationId, body);
        return { ok: true as const };
      },
      () => ({ resource: `health:${medicationId}`, summary: `Отметил приём: ${body.status === "taken" ? "принято" : "пропущено"} (${body.day} ${body.time})` })
    );
  }
}
