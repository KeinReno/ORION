"use client";

import { Badge, Input, StatCard } from "@orion/ui";
import type { InventoryAlertsApi } from "../../lib/extensions/contracts";

/**
 * Plugin `inventory-alerts`: the low-stock threshold and everything that shows it — the «Низкий остаток» card,
 * the badge on an item, the «ниже порога» hint. The stored `minStock`, the server's `lowStock` flag and the
 * low-stock notification do not depend on it; with it off the threshold simply is not shown or editable.
 */
export const inventoryAlertsApi: InventoryAlertsApi = {
  SummaryStat({ count }) {
    return (
      <StatCard
        label="Низкий остаток"
        value={<span className={count > 0 ? "text-destructive" : undefined}>{String(count)}</span>}
        hint={count > 0 ? "нужно пополнить" : "всё в порядке"}
      />
    );
  },

  ItemBadge() {
    return <Badge tone="danger">низкий остаток</Badge>;
  },

  balanceHint(lowStock) {
    return lowStock ? "ниже порога" : "в норме";
  },

  MinStockField({ value, onChange }) {
    return (
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Порог низкого остатка (необязательно)
        <Input inputMode="numeric" placeholder="Не уведомлять" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }
};
