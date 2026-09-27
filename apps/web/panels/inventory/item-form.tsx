"use client";

import type { InventoryItem, Project } from "@orion/shared-types";
import { Button, Input, Select } from "@orion/ui";
import { useState, type FormEvent } from "react";

/** Create/edit form for one склад position — rendered in the "Новая позиция" / "Изменить позицию" Modals, same split as habit-form.tsx. */

export interface InventoryItemFormValues {
  name: string;
  sku: string | null;
  unit: string;
  minStock: number | null;
  projectId: string | null;
}

const UNIT_SUGGESTIONS = ["шт", "кг", "л", "м", "уп"];

export function InventoryItemForm({
  initial,
  projects,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: InventoryItem;
  /** `undefined` when the "Проекты" module is off — the field is hidden, not disabled, per the module contract. */
  projects?: Project[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: InventoryItemFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "шт");
  const [minStock, setMinStock] = useState(initial?.minStock !== null && initial?.minStock !== undefined ? String(initial.minStock) : "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    const parsedMinStock = minStock.trim() ? Number(minStock) : null;
    void onSubmit({
      name: name.trim(),
      sku: sku.trim() || null,
      unit: unit.trim() || "шт",
      minStock: parsedMinStock !== null && Number.isFinite(parsedMinStock) ? Math.max(0, Math.round(parsedMinStock)) : null,
      projectId: projectId || null
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Название позиции" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={200} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Артикул (необязательно)" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={80} />
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Единица
          <Input list="inventory-units" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
          <datalist id="inventory-units">
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Порог низкого остатка (необязательно)
        <Input inputMode="numeric" placeholder="Не уведомлять" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
      </label>
      {projects ? (
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Проект
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Без проекта</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
