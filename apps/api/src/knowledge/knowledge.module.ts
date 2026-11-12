import { KnowledgePublicationAdapter } from "./knowledge-publication.adapter";
import { PublicationRegistryModule } from "../shared/publication-registry";
import { Module } from "@nestjs/common";
import { AgentCoreModule } from "../ai/agent-core.module";
import { AuthModule } from "../auth/auth.module";
import { InboxItemsModule } from "../inbox/public/inbox-items.module";
import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { SearchRegistryModule } from "../search/search-registry.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { KnowledgeAgentController } from "./knowledge.agent.controller";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeImportService } from "./knowledge-import.service";
import { KnowledgeRevisionsService } from "./knowledge-revisions.service";
import { KnowledgeSearchProvider } from "./knowledge-search.provider";
import { KnowledgeSearchService } from "./knowledge-search.service";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeSettingsService } from "./knowledge-settings.service";

@Module({
  imports: [PublicationRegistryModule, AuthModule, WorkspacesModule, ProjectReferencesModule, AgentCoreModule, InboxItemsModule, SearchRegistryModule],
  controllers: [KnowledgeController, KnowledgeAgentController],
  providers: [
    KnowledgePublicationAdapter,
    KnowledgeService,
    KnowledgeSettingsService,
    KnowledgeSearchService,
    KnowledgeSearchProvider,
    KnowledgeRevisionsService,
    KnowledgeImportService
  ]
})
export class KnowledgeModule {}
