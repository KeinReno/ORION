import { BadRequestException, Injectable } from "@nestjs/common";
import { restockQuantity, type AddInventoryToListInput, type LinkListItemInventoryInput, type ListItem, type PurchaseListItemResult } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { InventoryShoppingCommands } from "../inventory/public/inventory-shopping-commands";
import { ListShoppingCommands } from "../lists/public/list-shopping-commands";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Bridge composes owner commands in one transaction; alerts are delivered after commit. */
@Injectable()
export class ListsInventoryService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService, private readonly inventory: InventoryShoppingCommands,
    private readonly lists: ListShoppingCommands) {}

  async link(userId: string, workspaceId: string, listId: string, itemId: string, input: LinkListItemInventoryInput): Promise<ListItem> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      const item = await this.lists.itemTx(tx, workspaceId, listId, itemId);
      if (input.inventoryItemId) {
        const stock = await this.inventory.itemTx(tx, workspaceId, input.inventoryItemId);
        if (stock.archivedAt) throw new BadRequestException("Позиция склада в архиве");
      }
      return this.lists.linkTx(tx, workspaceId, listId, itemId, input.inventoryItemId, input.quantity ?? item.quantity);
    });
  }

  async purchase(userId: string, workspaceId: string, listId: string, itemId: string): Promise<PurchaseListItemResult> {
    const result = await this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      const item = await this.lists.lockItemTx(tx, workspaceId, listId, itemId);
      if (!item.inventoryItemId) throw new BadRequestException("Пункт не связан с позицией склада");
      if (item.stockedMovementId) return {
        item: await this.lists.completePurchaseTx(tx, workspaceId, listId, itemId, userId, null), movement: null, alert: null
      };
      const list = await this.lists.listTx(tx, workspaceId, listId);
      const { movement, alert } = await this.inventory.receiveTx(tx, workspaceId, item.inventoryItemId, item.quantity, `Куплено по списку «${list.name}»`);
      return { item: await this.lists.completePurchaseTx(tx, workspaceId, listId, itemId, userId, movement.id), movement, alert };
    });
    await this.inventory.deliverAlert(result.alert);
    return { item: result.item, movement: result.movement };
  }

  async addToList(userId: string, workspaceId: string, inventoryItemId: string, input: AddInventoryToListInput): Promise<ListItem> {
    return this.prisma.withUser(userId, async tx => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      const stock = await this.inventory.lockItemTx(tx, workspaceId, inventoryItemId);
      const list = await this.lists.listTx(tx, workspaceId, input.listId);
      if (list.archivedAt) throw new BadRequestException("Список в архиве");
      const open = await this.lists.openTx(tx, workspaceId, list.id, inventoryItemId);
      if (open) return open;
      const balance = await this.inventory.balanceTx(tx, workspaceId, inventoryItemId);
      return this.lists.addTx(tx, workspaceId, list.id, inventoryItemId, stock.name, input.quantity ?? restockQuantity(balance, stock.minStock));
    });
  }
}
