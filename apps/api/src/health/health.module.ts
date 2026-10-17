import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HealthController } from "./health.controller";
import { HealthMeasurementsController } from "./health-measurements.controller";
import { HealthMeasurementsService } from "./health-measurements.service";
import { HealthMedicationsController } from "./health-medications.controller";
import { HealthMedicationsService } from "./health-medications.service";
import { HealthSummaryService } from "./health-summary.service";
import { HealthSymptomsController } from "./health-symptoms.controller";
import { HealthSymptomsService } from "./health-symptoms.service";
import { HealthService } from "./health.service";

/** «Здоровье» (ADR-0012): данные принадлежат человеку, а не пространству. */
@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule],
  controllers: [HealthController, HealthMedicationsController, HealthMeasurementsController, HealthSymptomsController],
  providers: [HealthService, HealthMedicationsService, HealthMeasurementsService, HealthSymptomsService, HealthSummaryService]
})
export class HealthModule {}
