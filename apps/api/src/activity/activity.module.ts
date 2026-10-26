import { TaskJournalReaderModule } from "../tasks/public/task-journal-reader.module";
import { AgentJournalReaderModule } from "../ai/public/agent-journal-reader.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ActivityController } from "./activity.controller";
import { ActivityService } from "./activity.service";

@Module({
  imports: [TaskJournalReaderModule, AgentJournalReaderModule, AuthModule, WorkspacesModule, ModulesModule],
  controllers: [ActivityController],
  providers: [ActivityService]
})
export class ActivityModule {}
