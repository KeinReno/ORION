import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  addPetDays,
  agentPetDayPatchSchema,
  agentPetDiaryQuerySchema,
  computePetAlerts,
  createPetCareEventInputSchema,
  createPetCareEntryInputSchema,
  mergePetDay,
  petDayKeySchema,
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
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PetCareWellbeingService } from "./pet-care-wellbeing.service";
import { PetCareService } from "./pet-care.service";

/**
 * Инструменты ИИ-агента для Pet Care (G13). Описаны в `module.manifest.json` → `agent.tools`; разрешение, режим,
 * включённость модуля, лимит записи и журнал — в `AgentModuleToolsService`, здесь только вызов сервиса.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/pet-care")
export class PetCareAgentController {
  constructor(
    private readonly petCare: PetCareService,
    private readonly wellbeing: PetCareWellbeingService,
    private readonly tools: AgentModuleToolsService
  ) {}

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
}
