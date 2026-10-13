import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { InventoryAlertsService } from "./inventory-alerts.service";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

/** ORION v0.26 «Склад» — one controller/service pair, like habits/, plus the low-stock alert side-service (mirrors finance/budget-alerts.service.ts). */
@Module({
  imports: [AuthModule, WorkspacesModule, NotificationsModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryAlertsService],
  // The lists-inventory bridge writes its purchase receipts through InventoryService.recordMovementTx.
  exports: [InventoryService]
})
export class InventoryModule {}
