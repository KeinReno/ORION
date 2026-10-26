import { HomeUtilityReferencesModule } from "../home/public/home-utility-references.module";
import { Module } from "@nestjs/common";
import { PluginsModule } from "../plugins/plugins.module";
import { FinanceExpenseModule } from "../finance/public/expense.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HomeUtilitiesController } from "./home-utilities.controller";
import { HomeUtilitiesService } from "./home-utilities.service";

@Module({ imports: [HomeUtilityReferencesModule, PluginsModule, WorkspacesModule, FinanceExpenseModule], controllers: [HomeUtilitiesController], providers: [HomeUtilitiesService] })
export class HomeUtilitiesModule {}
