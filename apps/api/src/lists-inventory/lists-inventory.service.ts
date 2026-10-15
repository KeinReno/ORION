import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  restockQuantity,
  type AddInventoryToListInput,
  type LinkListItemInventoryInput,
  type ListItem,
  type PurchaseListItemResult
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { InventoryService, toMovementDto } from "../inventory/inventory.service";
import { toItemDto } from "../lists/lists.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** Entries are returned with the name of whoever ticked them, like everywhere in «Списки». */
const WHO = { checkedBy: { select: { name: true } } } as const;

/**
 * Plugin «Покупки → Склад» (`lists-inventory`): the bridge between «Списки» and
 * «Склад». It owns no table — only three columns on `list_items` — and writes
 * stock exclusively through `InventoryService.recordMovementTx`, so a purchase
 * is an ordinary receipt under the same row lock and low-stock logic as a
 * receipt entered by hand.
 *
 * Every call checks membership, both ends' workspace ownership (a user can be a
 * member of two spaces — RLS shows both rows, they still must not mix) and that
 * the Inventory module is on; the controller already requires Lists + the plugin.
 */
@Injectable()
export class ListsInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly inventory: InventoryService
  ) {}

  async link(userId: string, workspaceId: string, listId: string, itemId: string, input: LinkListItemInventoryInput): Promise<ListItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      const item = await this.assertListItemTx(tx, workspaceId, listId, itemId);
      if (input.inventoryItemId) {
        const stock = await this.assertInventoryItemTx(tx, workspaceId, input.inventoryItemId);
        if (stock.archivedAt) throw new BadRequestException("Позиция склада в архиве");
      }
      return tx.listItem.update({
        where: { id: itemId },
        data: { inventoryItemId: input.inventoryItemId, quantity: input.quantity ?? item.quantity },
        include: WHO
      });
    });
    return toItemDto(row);
  }

  /**
   * «Куплено»: ticks the entry and, the first time only, writes a receipt of
   * `quantity` units. The list-item row lock serialises two clicks (or two
   * windows); `stockedMovementId` (unique) is what makes a later re-tick a no-op
   * for stock. Unticking afterwards keeps the receipt — the movement ledger is
   * the source of truth and a correction is an explicit adjustment.
   */
  async purchase(userId: string, workspaceId: string, listId: string, itemId: string): Promise<PurchaseListItemResult> {
    const { row, movement, alert } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      await tx.$queryRaw`SELECT id FROM "list_items" WHERE id = ${itemId} FOR UPDATE`;
      const item = await this.assertListItemTx(tx, workspaceId, listId, itemId);
      if (!item.inventoryItemId) throw new BadRequestException("Пункт не связан с позицией склада");
      if (item.stockedMovementId) {
        const row = item.checked
          ? await tx.listItem.findUniqueOrThrow({ where: { id: itemId }, include: WHO })
          : await tx.listItem.update({ where: { id: itemId }, data: { checked: true, checkedAt: new Date(), checkedById: userId }, include: WHO });
        return { row, movement: null, alert: null };
      }
      const list = await tx.list.findUniqueOrThrow({ where: { id: listId }, select: { name: true } });
      const { movement, alert } = await this.inventory.recordMovementTx(tx, workspaceId, item.inventoryItemId, {
        type: "receipt",
        quantity: item.quantity,
        direction: "+",
        note: `Куплено по списку «${list.name}»`
      });
      const row = await tx.listItem.update({
        where: { id: itemId },
        data: { checked: true, stockedMovementId: movement.id, ...(item.checked ? {} : { checkedAt: new Date(), checkedById: userId }) },
        include: WHO
      });
      return { row, movement, alert };
    });
    await this.inventory.deliverAlert(alert);
    return { item: toItemDto(row), movement: movement ? toMovementDto(movement) : null };
  }

  /**
   * «В список покупок» from a stock item. Idempotent per list: an open
   * (unticked) entry already linked to this item is returned instead of a
   * duplicate. The stock-item row lock serialises a double click.
   */
  async addToList(userId: string, workspaceId: string, inventoryItemId: string, input: AddInventoryToListInput): Promise<ListItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.modules.assertEnabledTx(tx, userId, workspaceId, "inventory");
      await tx.$queryRaw`SELECT id FROM "inventory_items" WHERE id = ${inventoryItemId} FOR UPDATE`;
      const stock = await this.assertInventoryItemTx(tx, workspaceId, inventoryItemId);
      const list = await tx.list.findUnique({ where: { id: input.listId } });
      if (!list || list.workspaceId !== workspaceId) throw new NotFoundException("Список не найден");
      if (list.archivedAt) throw new BadRequestException("Список в архиве");

      const open = await tx.listItem.findFirst({ where: { listId: list.id, inventoryItemId, checked: false } });
      if (open) return tx.listItem.findUniqueOrThrow({ where: { id: open.id }, include: WHO });

      const totals = await tx.inventoryMovement.aggregate({ where: { itemId: inventoryItemId }, _sum: { quantity: true } });
      const quantity = input.quantity ?? restockQuantity(totals._sum.quantity ?? 0, stock.minStock);
      const last = await tx.listItem.aggregate({ where: { listId: list.id }, _max: { sortOrder: true } });
      return tx.listItem.create({
        data: { workspaceId, listId: list.id, label: stock.name, inventoryItemId, quantity, sortOrder: (last._max.sortOrder ?? 0) + 10 },
        include: WHO
      });
    });
    return toItemDto(row);
  }

  private async assertListItemTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string, itemId: string) {
    const item = await tx.listItem.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== workspaceId || item.listId !== listId) throw new NotFoundException("Пункт списка не найден");
    return item;
  }

  private async assertInventoryItemTx(tx: Prisma.TransactionClient, workspaceId: string, inventoryItemId: string) {
    const stock = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
    if (!stock || stock.workspaceId !== workspaceId) throw new NotFoundException("Позиция склада не найдена");
    return stock;
  }
}
