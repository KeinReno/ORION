import { assertHomeInWorkspace } from "../home/home-refs.util";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { List as ListRow, ListItem as ListItemRow, Prisma } from "@prisma/client";
import {
  LIST_ITEMS_MAX,
  listKindSchema,
  type ClearCheckedResult,
  type CreateListInput,
  type CreateListItemInput,
  type CreateListItemsBulkInput,
  type DuplicateListInput,
  type List,
  type ListItem,
  type ListItemSnapshot,
  type ReorderInput,
  type RestoreListItemsInput,
  type UpdateListInput,
  type UpdateListItemInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

export interface ListListsOptions {
  includeArchived?: boolean;
  /** `true` = only templates; otherwise templates are left out of the result. */
  templates?: boolean;
}

/** Step between neighbours' `sortOrder`, so a single move rarely has to touch more than the moved rows. */
const ORDER_STEP = 10;

/** Items come back in manual order, with the name of whoever ticked them (family lists: «купила Аня»). */
export const ITEMS_INCLUDE = {
  items: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { checkedBy: { select: { name: true } } }
  }
} satisfies Prisma.ListInclude;

type ItemRow = ListItemRow & { checkedBy?: { name: string } | null };

/**
 * ORION «Списки». Mirrors HabitsService: workspace-scoped, membership
 * checked first, everything inside `withUser`, DTOs assembled by hand.
 *
 * Unlike Habit/HabitEntry (two flat, independently-windowed collections — a
 * habit's tick history can be large), a list's items are few and always
 * wanted together with their list, so `list()`/`create()`/`update()` fetch
 * `items` as a normal Prisma `include` rather than a second flat endpoint.
 *
 * Every member of the workspace sees and edits every list: that is what makes a
 * shopping list a family list. Who ticked an entry is recorded (`checkedById`).
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
        where: {
          workspaceId,
          isTemplate: options.templates === true,
          ...(options.includeArchived ? {} : { archivedAt: null })
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: ITEMS_INCLUDE
      });
    });
    return rows.map(toDto);
  }

  /** One list in any state (active, archived, template) — what a list's own tab or window opens. */
  async get(userId: string, workspaceId: string, listId: string): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      return tx.list.findUniqueOrThrow({ where: { id: listId }, include: ITEMS_INCLUDE });
    });
    return toDto(row);
  }

  async create(userId: string, workspaceId: string, input: CreateListInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.homeId) await assertHomeInWorkspace(tx, workspaceId, input.homeId);
      const sortOrder = await this.nextListOrderTx(tx, workspaceId);
      if (input.templateId) {
        const source = await this.assertOwnedTx(tx, workspaceId, input.templateId);
        return this.copyListTx(tx, source, {
          name: input.name,
          kind: input.kind ?? parseKind(source.kind),
          isTemplate: false,
          keepChecked: false,
          sortOrder,
          homeId: input.homeId ?? source.homeId
        });
      }
      return tx.list.create({
        data: { workspaceId, name: input.name, kind: input.kind ?? "general", homeId: input.homeId ?? null, sortOrder },
        include: ITEMS_INCLUDE
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
          kind: input.kind,
          isTemplate: input.isTemplate,
          archivedAt: input.archivedAt === undefined ? undefined : input.archivedAt === null ? null : new Date(input.archivedAt)
        },
        include: ITEMS_INCLUDE
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

  /**
   * Real deletion — only for a list that is already in the archive (or a template), so it takes two
   * deliberate steps and never happens from the active view. Entries go with it (cascade); stock
   * receipts and finance expenses they created stay in their own ledgers.
   */
  async deletePermanently(userId: string, workspaceId: string, listId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const list = await this.assertOwnedTx(tx, workspaceId, listId);
      if (!list.archivedAt && !list.isTemplate) {
        throw new ConflictException("Сначала уберите список в архив — удалить можно только архивный список или шаблон");
      }
      await tx.list.delete({ where: { id: listId } });
    });
  }

  /** Manual order of the lists. Ids of other workspaces are rejected, not ignored. */
  async reorder(userId: string, workspaceId: string, input: ReorderInput): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const ids = unique(input.ids);
      const owned = await tx.list.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true } });
      if (owned.length !== ids.length) throw new NotFoundException("Список не найден");
      for (const [index, id] of ids.entries()) {
        await tx.list.update({ where: { id }, data: { sortOrder: (index + 1) * ORDER_STEP }, select: { id: true } });
      }
    });
  }

  /** A copy of the list: all entries, unticked unless `keepChecked`. Also how «save as template» works. */
  async duplicate(userId: string, workspaceId: string, listId: string, input: DuplicateListInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const source = await this.assertOwnedTx(tx, workspaceId, listId);
      const asTemplate = input.asTemplate ?? false;
      return this.copyListTx(tx, source, {
        name: input.name ?? (asTemplate ? `${source.name} — шаблон` : `${source.name} (копия)`).slice(0, 120),
        kind: parseKind(source.kind),
        isTemplate: asTemplate,
        keepChecked: input.keepChecked === true,
        sortOrder: await this.nextListOrderTx(tx, workspaceId),
        homeId: source.homeId
      });
    });
    return toDto(row);
  }

  /**
   * «Новый круг» for a reusable list (weekly groceries, packing): unticks everything and forgets who
   * bought what. The stock receipt / finance link of each entry is cleared too — the next purchase is a
   * new purchase — while the receipts and expenses themselves stay in their ledgers.
   */
  async reset(userId: string, workspaceId: string, listId: string): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      await tx.listItem.updateMany({
        where: { listId },
        data: { checked: false, checkedAt: null, checkedById: null, stockedMovementId: null, expenseTransactionId: null }
      });
      return tx.list.findUniqueOrThrow({ where: { id: listId }, include: ITEMS_INCLUDE });
    });
    return toDto(row);
  }

  async createItem(userId: string, workspaceId: string, listId: string, input: CreateListItemInput): Promise<ListItem> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      await this.assertRoomTx(tx, listId, 1);
      const sortOrder = await this.nextItemOrderTx(tx, listId);
      return tx.listItem.create({ data: itemData(workspaceId, listId, userId, input, sortOrder), include: { checkedBy: { select: { name: true } } } });
    });
    return toItemDto(row);
  }

  /** Pasted text / a template's contents: all-or-nothing, in the order given. */
  async createItemsBulk(userId: string, workspaceId: string, listId: string, input: CreateListItemsBulkInput): Promise<ListItem[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      await this.assertRoomTx(tx, listId, input.items.length);
      let sortOrder = await this.nextItemOrderTx(tx, listId);
      const created: ItemRow[] = [];
      for (const entry of input.items) {
        created.push(await tx.listItem.create({ data: itemData(workspaceId, listId, userId, entry, sortOrder), include: { checkedBy: { select: { name: true } } } }));
        sortOrder += ORDER_STEP;
      }
      return created;
    });
    return rows.map(toItemDto);
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
      const item = await this.assertItemOwnedTx(tx, workspaceId, listId, itemId);
      // Who ticked it, and when: set on the unticked→ticked edge, cleared on the way back; a repeated
      // "checked: true" (a second window, a retried request) keeps the original person and time.
      const ticking = input.checked === true && !item.checked;
      const unticking = input.checked === false && item.checked;
      return tx.listItem.update({
        where: { id: itemId },
        data: {
          label: input.label,
          checked: input.checked,
          quantity: input.quantity,
          unit: input.unit,
          note: input.note,
          dueAt: input.dueAt === undefined ? undefined : input.dueAt === null ? null : new Date(input.dueAt),
          section: input.section,
          priceMinor: input.priceMinor,
          ...(ticking ? { checkedAt: new Date(), checkedById: userId } : {}),
          ...(unticking ? { checkedAt: null, checkedById: null } : {})
        },
        include: { checkedBy: { select: { name: true } } }
      });
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

  /** Manual order of the entries of one list (ids first to last). */
  async reorderItems(userId: string, workspaceId: string, listId: string, input: ReorderInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      const ids = unique(input.ids);
      const owned = await tx.listItem.findMany({ where: { listId, id: { in: ids } }, select: { id: true } });
      if (owned.length !== ids.length) throw new NotFoundException("Пункт списка не найден");
      for (const [index, id] of ids.entries()) {
        await tx.listItem.update({ where: { id }, data: { sortOrder: (index + 1) * ORDER_STEP }, select: { id: true } });
      }
      return tx.list.findUniqueOrThrow({ where: { id: listId }, include: ITEMS_INCLUDE });
    });
    return toDto(row);
  }

  /**
   * The common "clear completed" action on a checklist. Returns what was removed, in full, so the
   * client's «Отменить» can put the very same entries back (`restoreItems`) — with their stock link and
   * receipt intact, which re-creating them from text would lose (and could restock twice).
   */
  async clearChecked(userId: string, workspaceId: string, listId: string): Promise<ClearCheckedResult> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      const removed = await tx.listItem.findMany({ where: { listId, checked: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
      if (removed.length > 0) await tx.listItem.deleteMany({ where: { id: { in: removed.map((item) => item.id) } } });
      return { removed: removed.map(toSnapshot) };
    });
  }

  /**
   * Puts deleted entries back under their original ids. Every reference is re-checked against THIS
   * workspace (and against being taken in the meantime): a vanished stock item / receipt / expense is
   * dropped from the entry, never trusted from the client. An id that exists again is skipped.
   */
  async restoreItems(userId: string, workspaceId: string, listId: string, input: RestoreListItemsInput): Promise<List> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, listId);
      await this.assertRoomTx(tx, listId, input.items.length);

      const wanted = <K extends keyof ListItemSnapshot>(key: K): string[] =>
        unique(input.items.map((item) => item[key]).filter((value): value is NonNullable<typeof value> & string => typeof value === "string"));
      const [stock, movements, expenses, people, taken, existing] = await Promise.all([
        tx.inventoryItem.findMany({ where: { workspaceId, id: { in: wanted("inventoryItemId") } }, select: { id: true } }),
        tx.inventoryMovement.findMany({ where: { workspaceId, id: { in: wanted("stockedMovementId") } }, select: { id: true } }),
        tx.transaction.findMany({ where: { workspaceId, id: { in: wanted("expenseTransactionId") } }, select: { id: true } }),
        tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: wanted("checkedById") } }, select: { userId: true } }),
        tx.listItem.findMany({ where: { stockedMovementId: { in: wanted("stockedMovementId") } }, select: { stockedMovementId: true } }),
        tx.listItem.findMany({ where: { id: { in: input.items.map((item) => item.id) } }, select: { id: true } })
      ]);
      const stockIds = new Set(stock.map((x) => x.id));
      const movementIds = new Set(movements.map((x) => x.id));
      const takenMovements = new Set(taken.map((x) => x.stockedMovementId));
      const expenseIds = new Set(expenses.map((x) => x.id));
      const peopleIds = new Set(people.map((x) => x.userId));
      const present = new Set(existing.map((x) => x.id));

      await tx.listItem.createMany({
        data: input.items
          .filter((item) => !present.has(item.id))
          .map((item) => ({
            id: item.id,
            workspaceId,
            listId,
            label: item.label,
            checked: item.checked,
            sortOrder: item.sortOrder,
            quantity: item.quantity,
            unit: item.unit,
            note: item.note,
            dueAt: item.dueAt ? new Date(item.dueAt) : null,
            section: item.section,
            priceMinor: item.priceMinor,
            inventoryItemId: item.inventoryItemId && stockIds.has(item.inventoryItemId) ? item.inventoryItemId : null,
            stockedMovementId:
              item.stockedMovementId && movementIds.has(item.stockedMovementId) && !takenMovements.has(item.stockedMovementId)
                ? item.stockedMovementId
                : null,
            expenseTransactionId: item.expenseTransactionId && expenseIds.has(item.expenseTransactionId) ? item.expenseTransactionId : null,
            checkedAt: item.checked && item.checkedAt ? new Date(item.checkedAt) : null,
            checkedById: item.checked && item.checkedById && peopleIds.has(item.checkedById) ? item.checkedById : null
          })),
        skipDuplicates: true
      });
      return tx.list.findUniqueOrThrow({ where: { id: listId }, include: ITEMS_INCLUDE });
    });
    return toDto(row);
  }

  private async copyListTx(
    tx: Prisma.TransactionClient,
    source: ListRow,
    options: { name: string; kind: ReturnType<typeof parseKind>; isTemplate: boolean; keepChecked: boolean; sortOrder: number; homeId: string | null }
  ): Promise<ListRow & { items: ItemRow[] }> {
    const items = await tx.listItem.findMany({ where: { listId: source.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const copy = await tx.list.create({
      data: {
        workspaceId: source.workspaceId,
        name: options.name,
        kind: options.kind,
        isTemplate: options.isTemplate,
        sortOrder: options.sortOrder,
        homeId: options.homeId
      }
    });
    if (items.length > 0) {
      await tx.listItem.createMany({
        data: items.map((item, index) => ({
          workspaceId: source.workspaceId,
          listId: copy.id,
          label: item.label,
          checked: options.keepChecked && !options.isTemplate ? item.checked : false,
          checkedAt: options.keepChecked && !options.isTemplate && item.checked ? item.checkedAt : null,
          sortOrder: (index + 1) * ORDER_STEP,
          quantity: item.quantity,
          unit: item.unit,
          note: item.note,
          section: item.section,
          priceMinor: item.priceMinor,
          // The stock link is a property of the entry; the receipt and the expense are properties of
          // one purchase — a copy starts a new purchase.
          inventoryItemId: item.inventoryItemId
        }))
      });
    }
    return tx.list.findUniqueOrThrow({ where: { id: copy.id }, include: ITEMS_INCLUDE });
  }

  private async nextListOrderTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<number> {
    const last = await tx.list.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + ORDER_STEP;
  }

  private async nextItemOrderTx(tx: Prisma.TransactionClient, listId: string): Promise<number> {
    const last = await tx.listItem.aggregate({ where: { listId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + ORDER_STEP;
  }

  private async assertRoomTx(tx: Prisma.TransactionClient, listId: string, adding: number): Promise<void> {
    const count = await tx.listItem.count({ where: { listId } });
    if (count + adding > LIST_ITEMS_MAX) {
      throw new BadRequestException(`В списке не может быть больше ${LIST_ITEMS_MAX} пунктов`);
    }
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

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function parseKind(value: string): "general" | "shopping" | "todo" | "packing" {
  const parsed = listKindSchema.safeParse(value);
  return parsed.success ? parsed.data : "general";
}

function itemData(workspaceId: string, listId: string, userId: string, input: CreateListItemInput, sortOrder: number): Prisma.ListItemUncheckedCreateInput {
  return {
    ...(input.checked ? { checked: true, checkedAt: new Date(), checkedById: userId } : {}),
    workspaceId,
    listId,
    label: input.label,
    sortOrder,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? null,
    note: input.note ?? "",
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    section: input.section ?? null,
    priceMinor: input.priceMinor ?? null
  };
}

function toDto(row: ListRow & { items: ItemRow[] }): List {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    kind: parseKind(row.kind),
    isTemplate: row.isTemplate,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    items: row.items.map(toItemDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/** Exported for the lists-inventory / lists-finance bridges, which return list items they link or buy. */
export function toItemDto(row: ItemRow): ListItem {
  return {
    id: row.id,
    listId: row.listId,
    label: row.label,
    checked: row.checked,
    sortOrder: row.sortOrder,
    inventoryItemId: row.inventoryItemId,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    section: row.section,
    priceMinor: row.priceMinor,
    stocked: row.stockedMovementId !== null,
    expenseTransactionId: row.expenseTransactionId,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    checkedById: row.checkedById,
    checkedByName: row.checkedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toSnapshot(row: ListItemRow): ListItemSnapshot {
  return {
    id: row.id,
    label: row.label,
    checked: row.checked,
    sortOrder: row.sortOrder,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    section: row.section,
    priceMinor: row.priceMinor,
    inventoryItemId: row.inventoryItemId,
    stockedMovementId: row.stockedMovementId,
    expenseTransactionId: row.expenseTransactionId,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    checkedById: row.checkedById
  };
}
