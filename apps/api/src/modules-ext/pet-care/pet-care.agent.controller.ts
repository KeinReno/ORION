import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  createPetCareEntryInputSchema,
  type CreatePetCareEntryInput,
  type PetCareEntry,
  type PetCarePet
} from "@orion/shared-types";
import { AgentModuleToolsService } from "../../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../../ai/agent-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
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
    private readonly tools: AgentModuleToolsService
  ) {}

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
