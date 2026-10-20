import { Body, Controller, Delete, Get, HttpCode, OnModuleInit, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  addPetDays,
  agentDeleteRequestSchema,
  agentPetDayPatchSchema,
  agentPetDiaryQuerySchema,
  computePetAlerts,
  createPetCareEventInputSchema,
  createPetCareEntryInputSchema,
  mergePetDay,
  petDayKeySchema,
  type AgentDeleteRequest,
  type AgentPetDayPatch,
  type AgentPetDiaryQuery,
  type CreatePetCareEntryInput,
  type CreatePetCareEventInput,
  type PetAlert,
  type PetCareDayLog,
  type PetCareEvent,
  type PetCareEntry,
  type PetCarePet
} from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PetCareWellbeingService } from "./pet-care-wellbeing.service";
import { PetCareService } from "./pet-care.service";

/** A pet's record is addressed as `<petId>:<id or day>` in requests: the service needs both. */
const splitKey = (key: string): [string, string] => {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
};

/**
 * Инструменты ИИ-агента для Pet Care (G13). Описаны в `module.manifest.json` → `agent.tools`; разрешение, режим,
 * включённость модуля, лимит записи и журнал — в `AgentModuleToolsService`, здесь только вызов сервиса.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/pet-care")
export class PetCareAgentController implements OnModuleInit {
  constructor(
    private readonly petCare: PetCareService,
    private readonly wellbeing: PetCareWellbeingService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    const petOf = async (userId: string, workspaceId: string, petId: string) =>
      (await this.petCare.listPets(userId, workspaceId).catch(() => [])).find((pet) => pet.id === petId);
    this.tools.register("orion_pet_care_delete_day", {
      noun: "день дневника",
      describe: async (userId, workspaceId, key) => {
        const [petId, day] = splitKey(key);
        const pet = await petOf(userId, workspaceId, petId);
        const log = pet ? (await this.wellbeing.listDays(userId, workspaceId, petId, { from: day, to: day }))[0] : undefined;
        return pet && log
          ? {
              title: `${pet.name}, ${day}`,
              fields: { status: log.status, appetite: log.appetite, vomitingCount: log.vomitingCount, note: log.note },
              labels: { status: "Состояние", appetite: "Аппетит", vomitingCount: "Рвота", note: "Заметка" }
            }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [petId, day] = splitKey(key);
        return this.wellbeing.deleteDay(userId, workspaceId, petId, day);
      }
    });
    this.tools.register("orion_pet_care_delete_event", {
      noun: "событие питомца",
      describe: async (userId, workspaceId, key) => {
        const [petId, eventId] = splitKey(key);
        const pet = await petOf(userId, workspaceId, petId);
        const event = pet ? (await this.wellbeing.listEvents(userId, workspaceId, petId, {})).find((item) => item.id === eventId) : undefined;
        return pet && event
          ? { title: `${pet.name}: ${event.title || event.type} (${event.day})`, fields: { type: event.type, day: event.day, title: event.title, note: event.note }, labels: { type: "Вид", day: "День", title: "Название", note: "Заметка" } }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [petId, eventId] = splitKey(key);
        return this.wellbeing.deleteEvent(userId, workspaceId, petId, eventId);
      }
    });
    this.tools.register("orion_pet_care_delete_entry", {
      noun: "запись ухода",
      describe: async (userId, workspaceId, key) => {
        const [petId, entryId] = splitKey(key);
        const pet = await petOf(userId, workspaceId, petId);
        const entry = pet ? (await this.petCare.listEntries(userId, workspaceId, petId)).find((item) => item.id === entryId) : undefined;
        return pet && entry
          ? { title: `${pet.name}: ${entry.kind} (${entry.occurredAt.slice(0, 10)})`, fields: { kind: entry.kind, occurredAt: entry.occurredAt, note: entry.note }, labels: { kind: "Вид", occurredAt: "Когда", note: "Заметка" } }
          : null;
      },
      apply: (userId, workspaceId, key) => {
        const [petId, entryId] = splitKey(key);
        return this.petCare.deleteEntry(userId, workspaceId, petId, entryId);
      }
    });
    this.tools.register("orion_pet_care_delete_pet", {
      noun: "питомец",
      describe: async (userId, workspaceId, petId) => {
        const pet = await petOf(userId, workspaceId, petId);
        return pet ? { title: pet.name, fields: { name: pet.name, species: pet.species, breed: pet.breed }, labels: { name: "Кличка", species: "Вид", breed: "Порода" } } : null;
      },
      apply: (userId, workspaceId, petId) => this.petCare.deletePet(userId, workspaceId, petId)
    });
  }

  /** The diary for a period (default: the last 30 days) and the warning signs the owner's own marks show — not a diagnosis. */
  @Get("pets/:petId/days")
  diary(
    @Req() req: AgentRequest,
    @Param("petId") petId: string,
    @Query(new ZodValidationPipe(agentPetDiaryQuerySchema)) query: AgentPetDiaryQuery
  ): Promise<{ days: PetCareDayLog[]; alerts: PetAlert[] }> {
    return this.tools.run(req, "orion_pet_care_diary", async (agent) => {
      const today = query.today ?? new Date().toISOString().slice(0, 10);
      const to = query.to ?? today;
      const from = query.from ?? addPetDays(to, -29);
      const days = await this.wellbeing.listDays(agent.userId, agent.workspaceId, petId, { from, to });
      return { days, alerts: computePetAlerts(days, today) };
    });
  }

  /** «Сегодня Мурчика дважды рвало»: the mentioned fields are added to what is already recorded for that day. */
  @Post("pets/:petId/days/:day")
  @HttpCode(200)
  recordDay(
    @Req() req: AgentRequest,
    @Param("petId") petId: string,
    @Param("day", new ZodValidationPipe(petDayKeySchema)) day: string,
    @Body(new ZodValidationPipe(agentPetDayPatchSchema)) body: AgentPetDayPatch
  ): Promise<PetCareDayLog> {
    return this.tools.run(
      req,
      "orion_pet_care_record_day",
      async (agent) => {
        const existing = (await this.wellbeing.listDays(agent.userId, agent.workspaceId, petId, { from: day, to: day }))[0] ?? null;
        return this.wellbeing.upsertDay(agent.userId, agent.workspaceId, petId, day, mergePetDay(existing, body));
      },
      (log) => ({ resource: `pet-care-day:${log.id}`, summary: `Отметил самочувствие питомца за ${day}` })
    );
  }

  @Post("pets/:petId/events")
  addEvent(
    @Req() req: AgentRequest,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(createPetCareEventInputSchema)) body: CreatePetCareEventInput
  ): Promise<PetCareEvent> {
    return this.tools.run(
      req,
      "orion_pet_care_add_event",
      (agent) => this.wellbeing.createEvent(agent.userId, agent.workspaceId, petId, body),
      (event) => ({ resource: `pet-care-event:${event.id}`, summary: `Записал событие питомца: ${event.title || event.type}` })
    );
  }

  @Get("pets")
  listPets(@Req() req: AgentRequest): Promise<PetCarePet[]> {
    return this.tools.run(req, "orion_pet_care_list_pets", (agent) => this.petCare.listPets(agent.userId, agent.workspaceId));
  }

  @Post("pets/:petId/entries")
  addEntry(
    @Req() req: AgentRequest,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(createPetCareEntryInputSchema)) body: CreatePetCareEntryInput
  ): Promise<PetCareEntry> {
    return this.tools.run(
      req,
      "orion_pet_care_add_entry",
      (agent) => this.petCare.createEntry(agent.userId, agent.workspaceId, petId, body),
      (entry) => ({ resource: `pet-care-entry:${entry.id}`, objectType: "pet-care-entry", objectId: entry.id, summary: `Запись ухода «${entry.kind}»` })
    );
  }

  @Delete("pets/:petId/days/:day")
  deleteDay(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("petId") petId: string,
    @Param("day") day: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_pet_care_delete_day", `${petId}:${day}`, {}, { reason: body.reason });
  }

  @Delete("pets/:petId/events/:eventId")
  deleteEvent(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("petId") petId: string,
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_pet_care_delete_event", `${petId}:${eventId}`, {}, { reason: body.reason });
  }

  @Delete("pets/:petId/entries/:entryId")
  deleteEntry(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("petId") petId: string,
    @Param("entryId") entryId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_pet_care_delete_entry", `${petId}:${entryId}`, {}, { reason: body.reason });
  }

  /** The pet with its whole diary and care log — the request says so to the human. */
  @Delete("pets/:petId")
  deletePet(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("petId") petId: string,
    @Body(new ZodValidationPipe(agentDeleteRequestSchema)) body: AgentDeleteRequest
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_pet_care_delete_pet", petId, {}, { reason: body.reason });
  }
}
