import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryModule } from "../inventory/inventory.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsInventoryController } from "./lists-inventory.controller";
import { ListsInventoryService } from "./lists-inventory.service";

/** Plugin «Покупки → Склад» — the Lists ↔ Inventory bridge; stock is written only through InventoryService. */
@Module({
  imports: [AuthModule, WorkspacesModule, InventoryModule],
  controllers: [ListsInventoryController],
  providers: [ListsInventoryService]
})
export class ListsInventoryModule {}
