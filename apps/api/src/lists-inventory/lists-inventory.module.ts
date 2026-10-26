import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InventoryShoppingCommandsModule } from "../inventory/public/inventory-shopping-commands.module";
import { ListShoppingCommandsModule } from "../lists/public/list-shopping-commands.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { ListsInventoryController } from "./lists-inventory.controller";
import { ListsInventoryService } from "./lists-inventory.service";

/** Plugin «Покупки → Склад» — the Lists ↔ Inventory bridge; stock is written only through InventoryService. */
@Module({
  imports: [AuthModule, WorkspacesModule, InventoryShoppingCommandsModule, ListShoppingCommandsModule],
  controllers: [ListsInventoryController],
  providers: [ListsInventoryService]
})
export class ListsInventoryModule {}
