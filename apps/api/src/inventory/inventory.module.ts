import { ProjectReferencesModule } from "../projects/public/project-references.module";
import { AgentCoreModule } from "../ai/agent-core.module";
import { InventoryAgentController } from "./inventory.agent.controller";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InventoryController } from "./inventory.controller";
import { InventoryCoreModule } from "./inventory-core.module";
import { InventoryProjectAggregates } from "./inventory-project-aggregates";

/** ORION v0.26 «Склад» — one controller/service pair, like habits/, plus the low-stock alert side-service (mirrors finance/budget-alerts.service.ts). */
@Module({
  imports: [InventoryCoreModule, ProjectReferencesModule, AuthModule, WorkspacesModule, NotificationsModule, AgentCoreModule],
  controllers: [InventoryController, InventoryAgentController],
  providers: [InventoryProjectAggregates],
  // The lists-inventory bridge writes its purchase receipts through InventoryService.recordMovementTx.
  exports: [InventoryCoreModule]
})
export class InventoryModule {}
