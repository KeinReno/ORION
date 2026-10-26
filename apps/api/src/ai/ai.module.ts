import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "../events/events.module";
import { FinanceModule } from "../finance/finance.module";
import { ModulesModule } from "../modules/modules.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { NoteOperationsModule } from "../notes/public/note-operations.module";
import { ProjectsModule } from "../projects/projects.module";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxModule } from "../inbox/inbox.module";
import { SearchModule } from "../search/search.module";
import { AssistantController } from "./assistant.controller";
import { AssistantChatService } from "./assistant-chat.service";
import { AssistantKeyService } from "./assistant-key.service";
import { AgentConnectionController } from "./agent-connection.controller";
import { AgentGatewayController } from "./agent-gateway.controller";
import { AgentGatewayService } from "./agent-gateway.service";
import { AgentJobsService } from "./agent-jobs.service";
import { AgentClientInstallService } from "./agent-client-install.service";
import { AgentCoreModule } from "./agent-core.module";
import { AgentUndoService } from "./agent-undo.service";
import { AgentTokensController, AiController } from "./ai.controller";

/** ORION AI Bridge (ADR-0007): scoped, audited, revocable access for external AI agents. */
@Module({
  imports: [AgentCoreModule, AuthModule, WorkspacesModule, ModulesModule, TaskOperationsModule, NoteOperationsModule, ProjectsModule, EventsModule, FinanceModule, NotificationsModule, InboxModule, SearchModule],
  controllers: [AgentTokensController, AiController, AgentGatewayController, AgentConnectionController, AssistantController],
  providers: [AgentClientInstallService, AgentJobsService, AgentUndoService, AgentGatewayService, AssistantKeyService, AssistantChatService],
  // Подключаемые модули (G13) строят свои `ai/v1/<модуль>/*` маршруты поверх AgentCoreModule (реэкспорт — для старых импортов AiModule).
  exports: [AgentCoreModule]
})
export class AiModule {}
