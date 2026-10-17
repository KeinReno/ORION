import { Module } from "@nestjs/common";
import { ProfilesModule } from "../opportunities-profiles/public";
import { HhImportModule } from "../opportunities-hh-import/hh-import.module";
import { AssistantModule } from "../opportunities-assistant/assistant.module";
import { ExecutionModule } from "../opportunities-execution/execution.module";
import { ManagerModule } from "../opportunities-manager/manager.module";
/** Composition boundary: Base does not import its concrete extensions. */
@Module({ imports: [ProfilesModule, HhImportModule, AssistantModule, ExecutionModule, ManagerModule] })
export class OpportunityExtensionsModule {}
