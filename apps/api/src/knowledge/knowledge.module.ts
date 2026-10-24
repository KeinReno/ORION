import { KnowledgePublicationAdapter } from "./knowledge-publication.adapter";
import { PublicationRegistryModule } from "../shared/publication-registry";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

@Module({
  imports: [PublicationRegistryModule, AuthModule, WorkspacesModule],
  controllers: [KnowledgeController],
  providers: [KnowledgePublicationAdapter, KnowledgeService]
})
export class KnowledgeModule {}
