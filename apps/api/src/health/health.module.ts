import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

/** «Здоровье» (ADR-0012): данные принадлежат человеку, а не пространству. */
@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule],
  controllers: [HealthController],
  providers: [HealthService]
})
export class HealthModule {}
