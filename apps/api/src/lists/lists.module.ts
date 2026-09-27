import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsController } from "./lists.controller";
import { ListsService } from "./lists.service";

/** ORION «Списки» — one controller/service pair, like habits/ or time/. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ListsController],
  providers: [ListsService]
})
export class ListsModule {}
