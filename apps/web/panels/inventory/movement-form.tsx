"use client";

import type { InventoryMovementType } from "@orion/shared-types";
import { AutosaveStatus, Button, GlideSelect, Input } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { useSlotContributions } from "../../lib/extensions/slot";
import { parseMoneyInput } from "../../lib/format";

const TYPE_LABEL: Record<InventoryMovementType, string> = {
  receipt: "Приход",
  issue: "Расход",
  adjustment: "Корректировка"
};

export interface InventoryMovementFormValues {
  type: InventoryMovementType;
  quantity: number;
  direction: "+" | "-";
  unitCostMinor: number | null;
  note: string;
}

/**
 * Records one ledger row. `unitCostMinor` only shows for a receipt (it's
 * what feeds the average-cost aggregate — see InventoryService); `direction`
 * only shows for an adjustment (receipt/issue already imply their sign, see
 * `createInventoryMovementInputSchema`).
 */
export function InventoryMovementForm({
  unit,
  busy,
  onSubmit,
  onCancel
}: {
  unit: string;
  busy: boolean;
  onSubmit: (values: InventoryMovementFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [type, setType] = useState<InventoryMovementType>("receipt");
  const [quantity, setQuantity] = useState("");
  const [direction, setDirection] = useState<"+" | "-">("+");
  const costing = useSlotContributions("inventory.costing")[0]?.meta?.api;
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");

  const qty = Number(quantity);
  const valid = quantity.trim() !== "" && Number.isFinite(qty) && qty > 0;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void onSubmit({
      type,
      quantity: Math.round(qty),
      direction,
      unitCostMinor: type === "receipt" && unitCost.trim() ? parseMoneyInput(unitCost) : null,
      note: note.trim()
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Тип движения
        <GlideSelect
          label="Тип движения"
          options={(Object.keys(TYPE_LABEL) as InventoryMovementType[]).map((item) => TYPE_LABEL[item])}
          value={TYPE_LABEL[type]}
          onChange={(label) => {
            const next = (Object.keys(TYPE_LABEL) as InventoryMovementType[]).find((item) => TYPE_LABEL[item] === label);
            if (next) setType(next);
          }}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Количество, {unit}
          <Input inputMode="decimal" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus required />
        </label>
        {type === "adjustment" ? (
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Направление
            <GlideSelect
              label="Направление"
              options={["Приход (+)", "Списание (−)"]}
              value={direction === "+" ? "Приход (+)" : "Списание (−)"}
              onChange={(label) => setDirection(label.startsWith("Приход") ? "+" : "-")}
            />
          </label>
        ) : type === "receipt" ? (
          costing ? <costing.UnitCostField value={unitCost} onChange={setUnitCost} /> : null
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        <span className="flex items-center justify-between gap-2">
          Комментарий (необязательно)
          <AutosaveStatus state="saved" explicit />
        </span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !valid}>
          Записать
        </Button>
      </div>
    </form>
  );
}
