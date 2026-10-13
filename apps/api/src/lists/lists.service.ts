import { assertHomeInWorkspace } from "../home/home-refs.util";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { List as ListRow, ListItem as ListItemRow, Prisma } from "@prisma/client";
import type { CreateListInput, CreateListItemInput, List, ListItem, UpdateListInput, UpdateListItemInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

export interface ListListsOptions {
  includeArchived?: boolean;
}

/**
 * ORION «Списки». Mirrors HabitsService: workspace-scoped, membership
 * checked first, everything inside `withUser`, DTOs assembled by hand.
 *
 * Unlike Habit/HabitEntry (two flat, independently-windowed collections — a
 * habit's tick history can be large), a list's items are few and always
 * wanted together with their list, so `list()`/`create()`/`update()` fetch
 * `items` as a normal Prisma `include` rather than a second flat endpoint.
 */
@Injectable()
export class ListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string, options: ListListsOptions = {}): Promise<List[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.list.findMany({
        where: { workspaceId, ...(options.includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ createdAt: "asc" }],
        include: { items: { orderBy: [{ createdAt: "asc" }] } }
      });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CreateListInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.homeId) await assertHomeInWorkspace(tx, workspaceId, input.homeId);
      return tx.list.create({
        data: { workspaceId, name: input.name, homeId: input.homeId ?? null },
        include: { items: { orderBy: [{ createdAt: "asc" }] } }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, listId: string, input: UpdateListInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      return tx.list.update({
        where: { id: listId },
        data: {
          name: input.name,
          archivedAt: input.archivedAt === undefined ? undefined : input.archivedAt === null ? null : new Date(input.archivedAt)
        },
        include: { items: { orderBy: [{ createdAt: "asc" }] } }
      });
    });
    return toDto(row);
  }

  /**
   * Archiving, not deletion — same choice as Habit/Project: a list can carry
   * a history worth keeping (a recurring grocery list you pause for a
   * while), and "done with this" isn't "erase it". Restore via
   * `update(..., { archivedAt: null })`.
   */
  async archive(userId: string, workspaceId: string, listId: string): Promise<List> {
    return this.update(userId, workspaceId, listId, { archivedAt: new Date().toISOString() });
  }

  async createItem(userId: string, workspaceId: string, listId: string, input: CreateListItemInput): Promise<ListItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      return tx.listItem.create({ data: { workspaceId, listId, label: input.label } });
    });
    return toItemDto(row);
  }

  async updateItem(
    userId: string,
    workspaceId: string,
    listId: string,
    itemId: string,
    input: UpdateListItemInput
  ): Promise<ListItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertItemOwnedTx(tx, workspaceId, listId, itemId);
      return tx.listItem.update({ where: { id: itemId }, data: { label: input.label, checked: input.checked } });
    });
    return toItemDto(row);
  }

  async deleteItem(userId: string, workspaceId: string, listId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertItemOwnedTx(tx, workspaceId, listId, itemId);
      await tx.listItem.delete({ where: { id: itemId } });
    });
  }

  /** The common "clear completed" action on a checklist — deletes every checked item in one call. */
  async clearChecked(userId: string, workspaceId: string, listId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      await tx.listItem.deleteMany({ where: { listId, checked: true } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, listId: string): Promise<ListRow> {
    const list = await tx.list.findUnique({ where: { id: listId } });
    if (!list || list.workspaceId !== workspaceId) throw new NotFoundException("Список не найден");
    return list;
  }

  private async assertItemOwnedTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    listId: string,
    itemId: string
  ): Promise<ListItemRow> {
    const item = await tx.listItem.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== workspaceId || item.listId !== listId) {
      throw new NotFoundException("Пункт списка не найден");
    }
    return item;
  }
}

function toDto(row: ListRow & { items: ListItemRow[] }): List {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    items: row.items.map(toItemDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/** Exported for the lists-inventory bridge, which returns list items it links or buys. */
export function toItemDto(row: ListItemRow): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    label: row.label,
    checked: row.checked,
    inventoryItemId: row.inventoryItemId,
    quantity: row.quantity,
    stocked: row.stockedMovementId !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
