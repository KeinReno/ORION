import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CreateInventoryItemInput,
  CreateInventoryMovementInput,
  InventoryItem,
  InventoryMovement,
  UpdateInventoryItemInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { InventoryAlertsService } from "./inventory-alerts.service";

interface ItemTotals {
  balance: number;
  avgCostMinor: number | null;
}

/**
 * ORION v0.26 «Склад». Mirrors notes/habits: workspace-scoped, membership
 * checked first, everything inside `withUser`, DTOs assembled by hand.
 *
 * `balance`/`avgCostMinor` are never stored — see the file comment in
 * `@orion/shared-types/inventory.ts`. `computeTotalsTx` is the one place
 * that turns the movement ledger into both numbers, for every item in the
 * workspace at once (the list view) or via a single-item aggregate (the
 * concurrency guard in `recordMovement`).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly alerts: InventoryAlertsService
  ) {}

  async list(userId: string, workspaceId: string, includeArchived = false): Promise<InventoryItem[]> {
    const { items, totals } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const items = await tx.inventoryItem.findMany({
        where: { workspaceId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: { createdAt: "asc" }
      });
      const totals = await computeTotalsTx(tx, workspaceId);
      return { items, totals };
    });
    return items.map((item) => toDto(item, totals.get(item.id) ?? { balance: 0, avgCostMinor: null }));
  }

  async create(userId: string, workspaceId: string, input: CreateInventoryItemInput): Promise<InventoryItem> {
    const item = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      if (input.projectId) await this.assertProjectTx(tx, workspaceId, input.projectId);
      return tx.inventoryItem.create({
        data: {
          workspaceId,
          name: input.name,
          sku: input.sku ?? null,
          unit: input.unit,
          minStock: input.minStock ?? null,
          projectId: input.projectId ?? null
        }
      });
    });
    return toDto(item, { balance: 0, avgCostMinor: null });
  }

  async update(
    userId: string,
    workspaceId: string,
    itemId: string,
    input: UpdateInventoryItemInput
  ): Promise<InventoryItem> {
    const { item, totals } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, itemId);
      if (input.projectId) await this.assertProjectTx(tx, workspaceId, input.projectId);
      const item = await tx.inventoryItem.update({
        where: { id: itemId },
        data: {
          name: input.name,
          sku: input.sku,
          unit: input.unit,
          minStock: input.minStock,
          projectId: input.projectId,
          archivedAt: input.archivedAt === undefined ? undefined : input.archivedAt === null ? null : new Date(input.archivedAt)
        }
      });
      const totals = await computeTotalsTx(tx, workspaceId);
      return { item, totals };
    });
    return toDto(item, totals.get(item.id) ?? { balance: 0, avgCostMinor: null });
  }

  /** Archiving, not deletion — same choice as habits/projects: the movement ledger stays intact. */
  async archive(userId: string, workspaceId: string, itemId: string): Promise<InventoryItem> {
    return this.update(userId, workspaceId, itemId, { archivedAt: new Date().toISOString() });
  }

  async listMovements(userId: string, workspaceId: string, itemId: string): Promise<InventoryMovement[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, itemId);
      return tx.inventoryMovement.findMany({ where: { itemId }, orderBy: { createdAt: "desc" }, take: 500 });
    });
    return rows.map(toMovementDto);
  }

  /**
   * Writes one ledger row and, for an issue/adjustment that would take the
   * balance negative, rejects it instead. `SELECT ... FOR UPDATE` on the item
   * row serialises concurrent movements against the *same* item — the
   * balance isn't a stored column a `CHECK` constraint could guard, so two
   * racing issues both reading "balance = 3" and both writing "-2" is exactly
   * the failure this lock closes (see docs/HISTORY.md v0.26).
   */
  async recordMovement(
    userId: string,
    workspaceId: string,
    itemId: string,
    input: CreateInventoryMovementInput
  ): Promise<InventoryMovement> {
    const delta = deltaFor(input);
    const { movement, alert } = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await tx.$queryRaw`SELECT id FROM "inventory_items" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
      if (!item || item.workspaceId !== workspaceId) throw new NotFoundException("Позиция не найдена");

      if (delta < 0) {
        const current = await tx.inventoryMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
        const balance = current._sum.quantity ?? 0;
        if (balance + delta < 0) {
          throw new BadRequestException(`Недостаточно остатка: на складе ${balance} ${item.unit}`);
        }
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          workspaceId,
          itemId,
          type: input.type,
          quantity: delta,
          unitCostMinor: input.type === "receipt" ? input.unitCostMinor ?? null : null,
          note: input.note ?? ""
        }
      });

      const after = await tx.inventoryMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
      const alert = await this.alerts.evaluateTx(tx, item, after._sum.quantity ?? 0);
      return { movement, alert };
    });
    await this.alerts.deliver(alert);
    return toMovementDto(movement);
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== workspaceId) throw new NotFoundException("Позиция не найдена");
    return item;
  }

  private async assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
  }
}

interface TotalsRow {
  item_id: string;
  balance: number;
  cost_sum: string;
  cost_qty: number;
}

/**
 * One raw aggregate over the whole workspace's ledger, grouped by item —
 * shared by `list` (every item at once) the same way `computeNetByAccount`
 * covers every finance account at once. `cost_sum`/`cost_qty` only count
 * `receipt` rows that carry a cost, so an issue or an uncosted receipt never
 * skews the average (see the simplified-WAC note in the shared-types file).
 */
async function computeTotalsTx(tx: Prisma.TransactionClient, workspaceId: string): Promise<Map<string, ItemTotals>> {
  const rows = await tx.$queryRaw<TotalsRow[]>`
    SELECT
      "itemId" AS item_id,
      SUM(quantity)::int AS balance,
      SUM(CASE WHEN "type" = 'receipt' AND "unitCostMinor" IS NOT NULL THEN quantity * "unitCostMinor" ELSE 0 END)::bigint AS cost_sum,
      SUM(CASE WHEN "type" = 'receipt' AND "unitCostMinor" IS NOT NULL THEN quantity ELSE 0 END)::int AS cost_qty
    FROM "inventory_movements"
    WHERE "workspaceId" = ${workspaceId}
    GROUP BY "itemId"
  `;
  const totals = new Map<string, ItemTotals>();
  for (const row of rows) {
    const costQty = row.cost_qty;
    totals.set(row.item_id, {
      balance: row.balance,
      avgCostMinor: costQty > 0 ? Math.round(Number(row.cost_sum) / costQty) : null
    });
  }
  return totals;
}

/** Positive for a receipt, negative for an issue; an adjustment's sign comes from `direction`. */
function deltaFor(input: CreateInventoryMovementInput): number {
  if (input.type === "receipt") return input.quantity;
  if (input.type === "issue") return -input.quantity;
  return input.direction === "-" ? -input.quantity : input.quantity;
}

type ItemRow = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  sku: string | null;
  name: string;
  unit: string;
  minStock: number | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(item: ItemRow, totals: ItemTotals): InventoryItem {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    minStock: item.minStock,
    balance: totals.balance,
    avgCostMinor: totals.avgCostMinor,
    lowStock: item.minStock !== null && totals.balance <= item.minStock,
    archivedAt: item.archivedAt ? item.archivedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

type MovementRow = {
  id: string;
  workspaceId: string;
  itemId: string;
  type: string;
  quantity: number;
  unitCostMinor: number | null;
  note: string;
  createdAt: Date;
};

function toMovementDto(row: MovementRow): InventoryMovement {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    itemId: row.itemId,
    type: row.type as InventoryMovement["type"],
    quantity: row.quantity,
    unitCostMinor: row.unitCostMinor,
    note: row.note,
    createdAt: row.createdAt.toISOString()
  };
}
