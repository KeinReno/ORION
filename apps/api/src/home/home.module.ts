import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModulesModule } from "../modules/modules.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";

@Module({
  imports: [AuthModule, WorkspacesModule, ModulesModule],
  controllers: [HomeController],
  providers: [HomeService]
})
export class HomeModule {}
