import { Body, Controller, Delete, Get, HttpCode, OnModuleInit, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  agentDeleteRequestSchema,
  agentHealthMeasurementsQuerySchema,
  agentHealthMedicationsQuerySchema,
  agentHealthOverviewQuerySchema,
  agentHealthSymptomsQuerySchema,
  createHealthAppointmentInputSchema,
  createHealthMeasurementInputSchema,
  createHealthSymptomInputSchema,
  putHealthIntakeInputSchema,
  type AgentDeleteRequest,
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
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { HealthMeasurementsService } from "./health-measurements.service";
import { HealthMedicationsService } from "./health-medications.service";
import { HealthSummaryService } from "./health-summary.service";
import { HealthSymptomsService } from "./health-symptoms.service";
import { HealthService } from "./health.service";

/** A nested record is addressed as `<parentId>:<id>` (or more parts) in requests: the service needs every id. */
const splitKey = (key: string): string[] => key.split(":");

/**
 * Инструменты ИИ-агента для модуля «Здоровье» (G13). Всё — от имени человека-владельца токена и его же правами: чужие
 * приватные записи (ADR-0021) агенту не видны так же, как ему самому. Агент записывает наблюдения, визиты и отметки о
 * приёме; дозы и диагнозы не предлагает. Разрешение, режим, включённость модуля, лимит и журнал — в `AgentModuleToolsService`.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/health")
export class HealthAgentController implements OnModuleInit {
  constructor(
    private readonly health: HealthService,
    private readonly summaries: HealthSummaryService,
    private readonly measurements: HealthMeasurementsService,
    private readonly symptoms: HealthSymptomsService,
    private readonly medications: HealthMedicationsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  /** Each record is looked up with the human's own read rights — another person's private record stays invisible. */
  onModuleInit(): void {
    this.tools.register("orion_health_delete_measurement", {
      noun: "измерение",
      describe: async (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        const item = (await this.measurements.list(userId, workspaceId, subjectId, {}).catch(() => [])).find((entry) => entry.id === id);
        return item
          ? {
              title: `${item.kind}: ${item.value}${item.value2 !== null ? `/${item.value2}` : ""} (${item.measuredAt.slice(0, 10)})`,
              fields: { kind: item.kind, value: item.value, value2: item.value2, measuredAt: item.measuredAt, note: item.note },
              labels: { kind: "Показатель", value: "Значение", value2: "Второе значение", measuredAt: "Когда", note: "Заметка" }
            }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        return this.measurements.remove(userId, workspaceId, subjectId, id);
      }
    });
    this.tools.register("orion_health_delete_symptom", {
      noun: "симптом",
      describe: async (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        const item = (await this.symptoms.list(userId, workspaceId, subjectId).catch(() => [])).find((entry) => entry.id === id);
        return item
          ? {
              title: `${item.name} (${item.startedAt.slice(0, 10)})`,
              fields: { name: item.name, severity: item.severity, startedAt: item.startedAt, endedAt: item.endedAt },
              labels: { name: "Симптом", severity: "Сила", startedAt: "Начало", endedAt: "Конец" }
            }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        return this.symptoms.remove(userId, workspaceId, subjectId, id);
      }
    });
    this.tools.register("orion_health_delete_appointment", {
      noun: "визит",
      describe: async (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        const item = (await this.health.listAppointments(userId, workspaceId, subjectId).catch(() => [])).find((entry) => entry.id === id);
        return item
          ? {
              title: `${item.title} (${item.at.slice(0, 10)})`,
              fields: { title: item.title, at: item.at, clinic: item.clinic, purpose: item.purpose },
              labels: { title: "Визит", at: "Когда", clinic: "Клиника", purpose: "Цель" }
            }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [subjectId, id] = splitKey(key);
        return this.health.removeAppointment(userId, workspaceId, subjectId, id);
      }
    });
  }

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

  @Delete(":subjectId/measurements/:measurementId")
  deleteMeasurement(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("subjectId") subjectId: string,
    @Param("measurementId") measurementId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_health_delete_measurement", `${subjectId}:${measurementId}`, {}, { reason: body.reason });
  }

  @Delete(":subjectId/symptoms/:symptomId")
  deleteSymptom(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("subjectId") subjectId: string,
    @Param("symptomId") symptomId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_health_delete_symptom", `${subjectId}:${symptomId}`, {}, { reason: body.reason });
  }

  @Delete(":subjectId/appointments/:appointmentId")
  deleteAppointment(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("subjectId") subjectId: string,
    @Param("appointmentId") appointmentId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_health_delete_appointment", `${subjectId}:${appointmentId}`, {}, { reason: body.reason });
  }
}
