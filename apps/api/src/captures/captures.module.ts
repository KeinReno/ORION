import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TasksModule } from "../tasks/tasks.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CapturesController } from "./captures.controller";
import { CapturesService } from "./captures.service";

@Module({
  imports: [AuthModule, WorkspacesModule, TasksModule],
  controllers: [CapturesController],
  providers: [CapturesService],
  exports: [CapturesService]
})
export class CapturesModule {}
