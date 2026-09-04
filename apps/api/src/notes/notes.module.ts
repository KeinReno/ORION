import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { NotesController } from "./notes.controller";
import { NotesService } from "./notes.service";

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [NotesController],
  providers: [NotesService]
})
export class NotesModule {}
