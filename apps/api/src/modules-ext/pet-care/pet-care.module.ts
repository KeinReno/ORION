import { Module } from "@nestjs/common";
import { AiModule } from "../../ai/ai.module";
import { AuthModule } from "../../auth/auth.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { PetCareAgentController } from "./pet-care.agent.controller";
import { PetCareController } from "./pet-care.controller";
import { PetCareService } from "./pet-care.service";

/** Pet Care — образец модуля, подключённого манифестом (см. MODULE.md). Структура — как у habits/. */
@Module({
  imports: [AuthModule, WorkspacesModule, AiModule],
  controllers: [PetCareController, PetCareAgentController],
  providers: [PetCareService]
})
export class PetCareModule {}
