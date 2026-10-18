import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { PetCareController } from "./pet-care.controller";
import { PetCareService } from "./pet-care.service";

/** Pet Care — образец модуля, подключённого манифестом (см. MODULE.md). Структура — как у habits/. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [PetCareController],
  providers: [PetCareService]
})
export class PetCareModule {}
