import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TimeController } from "./time.controller";
import { TimeService } from "./time.service";
import { TimeProjectAggregates } from "./time-project-aggregates";

/** ORION v0.18 «Учёт времени» — one controller/service pair, like notes/ or tasks/. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [TimeController],
  providers: [TimeProjectAggregates, TimeService]
})
export class TimeModule {}
