import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { TimeController } from "./time.controller";
import { TimeService } from "./time.service";

/** ORION v0.18 «Учёт времени» — one controller/service pair, like notes/ or tasks/. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [TimeController],
  providers: [TimeService]
})
export class TimeModule {}
