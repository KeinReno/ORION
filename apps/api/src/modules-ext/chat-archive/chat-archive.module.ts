import { Module } from "@nestjs/common";
import { AgentCoreModule } from "../../ai/agent-core.module";
import { AuthModule } from "../../auth/auth.module";
import { ModulesModule } from "../../modules/modules.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ChatArchiveAgentController } from "./chat-archive.agent.controller";
import { ChatArchiveController } from "./chat-archive.controller";
import { ChatArchiveDiscoveryService } from "./chat-archive-discovery.service";
import { ChatArchiveHookController } from "./chat-archive.hook.controller";
import { ChatArchiveService } from "./chat-archive.service";

/** Архив чатов — модуль, подключённый манифестом (см. MODULE.md). Структура — как у pet-care/. */
@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule, AgentCoreModule],
  controllers: [ChatArchiveController, ChatArchiveAgentController, ChatArchiveHookController],
  providers: [ChatArchiveService, ChatArchiveDiscoveryService]
})
export class ChatArchiveModule {}
