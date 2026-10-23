import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService]
})
export class KnowledgeModule {}
