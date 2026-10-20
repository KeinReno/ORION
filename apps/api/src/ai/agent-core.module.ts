import { Module } from "@nestjs/common";
import { ModulesModule } from "../modules/modules.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { AgentModuleToolsService } from "./agent-module-tools.service";
import { AgentPresenceService } from "./agent-presence.service";
import { AgentTokenGuard } from "./agent-token.guard";
import { AgentTokensService } from "./agent-tokens.service";

/**
 * The part of the AI bridge a domain module needs to expose its own agent tools (`ai/v1/<module>/*`, G13): token check,
 * the tool wrapper (permission → mode → module on → write limit → journal) and the live feed. Kept apart from `AiModule`,
 * which imports tasks/notes/finance…: a module those depend on (documents, finance) could not import `AiModule` back.
 */
@Module({
  imports: [WorkspacesModule, ModulesModule, NotificationsModule],
  providers: [AgentPresenceService, AgentTokensService, AgentTokenGuard, AgentModuleToolsService],
  exports: [AgentPresenceService, AgentTokensService, AgentTokenGuard, AgentModuleToolsService]
})
export class AgentCoreModule {}
