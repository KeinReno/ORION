import { AgentCoreModule } from "../ai/agent-core.module";
import { HabitsAgentController } from "./habits.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HabitsController } from "./habits.controller";
import { HabitsService } from "./habits.service";

/** ORION v0.19 «Привычки» — one controller/service pair, like notes/ or time/. */
@Module({
  imports: [AuthModule, WorkspacesModule, AgentCoreModule],
  controllers: [HabitsController, HabitsAgentController],
  providers: [HabitsService]
})
export class HabitsModule {}
