import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsController } from "./lists.controller";
import { ListsService } from "./lists.service";
import { SearchRegistryModule } from "../search/search-registry.module";
import { ListsSearchProvider } from "./lists-search.provider";

/** ORION «Списки» — one controller/service pair, like habits/ or time/. */
@Module({
  imports: [AuthModule, WorkspacesModule, SearchRegistryModule],
  controllers: [ListsController],
  providers: [ListsService, ListsSearchProvider]
})
export class ListsModule {}
