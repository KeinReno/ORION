import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CapturesController } from "./captures.controller";
import { CapturesService } from "./captures.service";
import { EntityReferenceRegistryModule } from "../common/entity-reference-registry";
import { CaptureReferenceMoves } from "./capture-reference-moves";

@Module({
  imports: [AuthModule, WorkspacesModule, TasksModule, EntityReferenceRegistryModule],
  controllers: [CapturesController],
  providers: [CapturesService, CaptureReferenceMoves],
  exports: [CapturesService]
})
export class CapturesModule {}
