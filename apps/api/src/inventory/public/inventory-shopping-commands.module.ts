import { Module } from "@nestjs/common";
import { InventoryCoreModule } from "../inventory-core.module";
import { InventoryShoppingWrites } from "../inventory-shopping-commands.service";
import { InventoryShoppingCommands } from "./inventory-shopping-commands";

@Module({ imports: [InventoryCoreModule], providers: [{ provide: InventoryShoppingCommands, useClass: InventoryShoppingWrites }], exports: [InventoryShoppingCommands] })
export class InventoryShoppingCommandsModule {}
