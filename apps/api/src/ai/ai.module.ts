import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
import { FinanceModule } from "../finance/finance.module";
import { ModulesModule } from "../modules/modules.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { NotesModule } from "../notes/notes.module";
import { ProjectsModule } from "../projects/projects.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxModule } from "../inbox/inbox.module";
import { SearchModule } from "../search/search.module";
import { AssistantController } from "./assistant.controller";
import { AssistantChatService } from "./assistant-chat.service";
import { AssistantKeyService } from "./assistant-key.service";
import { AgentConnectionController } from "./agent-connection.controller";
import { AgentGatewayController } from "./agent-gateway.controller";
import { AgentGatewayService } from "./agent-gateway.service";
import { AgentTokenGuard } from "./agent-token.guard";
import { AgentModuleToolsService } from "./agent-module-tools.service";
import { AgentJobsService } from "./agent-jobs.service";
import { AgentClientInstallService } from "./agent-client-install.service";
import { AgentPresenceService } from "./agent-presence.service";
import { AgentTokensService } from "./agent-tokens.service";
import { AgentUndoService } from "./agent-undo.service";
import { AgentTokensController, AiController } from "./ai.controller";

/** ORION AI Bridge (ADR-0007): scoped, audited, revocable access for external AI agents. */
@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule, TasksModule, NotesModule, ProjectsModule, EventsModule, FinanceModule, NotificationsModule, InboxModule, SearchModule],
  controllers: [AgentTokensController, AiController, AgentGatewayController, AgentConnectionController, AssistantController],
  providers: [AgentClientInstallService, AgentPresenceService, AgentTokensService, AgentJobsService, AgentUndoService, AgentGatewayService, AgentTokenGuard, AgentModuleToolsService, AssistantKeyService, AssistantChatService],
  // Подключаемые модули (G13) строят свои `ai/v1/<модуль>/*` маршруты поверх этих трёх.
  exports: [AgentPresenceService, AgentTokensService, AgentTokenGuard, AgentModuleToolsService]
})
export class AiModule {}
