"use client";

import { Input, StatCard } from "@orion/ui";
import type { InventoryCostingApi } from "../../lib/extensions/contracts";
import { formatMoney } from "../../lib/format";

/**
 * Plugin `inventory-costing`: the price of a receipt and the average cost that grows out of it. The balance and the
 * ledger of movements are the module's own and do not depend on prices; the server keeps storing a receipt's unit
 * price when one is sent and computes `avgCostMinor` — with the plugin off they are simply neither asked for nor shown.
 */
export const inventoryCostingApi: InventoryCostingApi = {
  CardLine({ avgCostMinor }) {
    return avgCostMinor !== null ? <p className="text-2xs text-subtle-foreground">Средняя себестоимость: {formatMoney(avgCostMinor)}</p> : <></>;
  },

  DetailStat({ avgCostMinor }) {
    return (
      <StatCard
        label="Средняя себестоимость"
        value={avgCostMinor !== null ? formatMoney(avgCostMinor) : "—"}
        hint={avgCostMinor !== null ? "по приходам" : "нет данных"}
      />
    );
  },

  UnitCostField({ value, onChange }) {
    return (
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Цена за единицу, ₽ (необязательно)
        <Input inputMode="decimal" placeholder="0" value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }
};
