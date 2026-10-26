import { FinanceOverviewReaderModule } from "../finance/public/finance-overview-reader.module";
import { TaskOverviewReaderModule } from "../tasks/public/task-overview-reader.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { OverviewController } from "./overview.controller";
import { OverviewService } from "./overview.service";

@Module({
  imports: [TaskOverviewReaderModule, FinanceOverviewReaderModule, AuthModule, WorkspacesModule],
  controllers: [OverviewController],
  providers: [OverviewService]
})
export class OverviewModule {}
