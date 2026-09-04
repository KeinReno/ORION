import { Module } from "@nestjs/common";
import { PrismaModule } from "./common/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { NotesModule } from "./notes/notes.module";

@Module({
  imports: [PrismaModule, AuthModule, WorkspacesModule, NotesModule]
})
export class AppModule {}
