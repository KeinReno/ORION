import { TaskIntegrationReaderModule } from "../tasks/public/task-integration-reader.module";
import { ProjectAgentReaderModule } from "../projects/public/project-agent-reader.module";
import { TaskProposalReaderModule } from "../tasks/public/task-proposal-reader.module";
import { NoteAgentReferencesModule } from "../notes/public/note-agent-references.module";
import { EventAgentReferencesModule } from "../events/public/event-agent-references.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EventOperationsModule } from "../events/public/event-operations.module";
import { AgentDraftOperationsModule } from "../finance/public/agent-draft-operations.module";
import { ModulesModule } from "../modules/modules.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { NoteOperationsModule } from "../notes/public/note-operations.module";
import { ProjectCatalogModule } from "../projects/public/project-catalog.module";
import { TaskOperationsModule } from "../tasks/public/task-operations.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InboxAgentOperationsModule } from "../inbox/public/inbox-agent-operations.module";
import { SearchOperationsModule } from "../search/public/search-operations.module";
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
  imports: [ProjectAgentReaderModule, TaskIntegrationReaderModule, TaskProposalReaderModule, NoteAgentReferencesModule, EventAgentReferencesModule, AgentCoreModule, AuthModule, WorkspacesModule, ModulesModule, TaskOperationsModule, NoteOperationsModule, ProjectCatalogModule, EventOperationsModule, AgentDraftOperationsModule, NotificationsModule, InboxAgentOperationsModule, SearchOperationsModule],
  controllers: [AgentTokensController, AiController, AgentGatewayController, AgentConnectionController, AssistantController],
  providers: [AgentClientInstallService, AgentJobsService, AgentUndoService, AgentGatewayService, AssistantKeyService, AssistantChatService],
  // Подключаемые модули (G13) строят свои `ai/v1/<модуль>/*` маршруты поверх AgentCoreModule (реэкспорт — для старых импортов AiModule).
  exports: [AgentCoreModule]
})
export class AiModule {}
