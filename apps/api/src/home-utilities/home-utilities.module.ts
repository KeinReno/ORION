import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module";
import { FinanceModule } from "../finance/finance.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HomeUtilitiesController } from "./home-utilities.controller";
import { HomeUtilitiesService } from "./home-utilities.service";

@Module({ imports: [PluginsModule, WorkspacesModule, FinanceModule], controllers: [HomeUtilitiesController], providers: [HomeUtilitiesService] })
export class HomeUtilitiesModule {}
