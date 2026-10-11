"use client";

import type { Budget, FinanceCategory } from "@orion/shared-types";
import { Button, Input, Select } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { fromKopecks, toKopecks } from "../../lib/extensions/host-api";

export interface BudgetFormValues {
  categoryId: string;
  month: string;
  limitAmount: number;
}

/** "YYYY-MM" (native `<input type="month">`) → first-of-month ISO datetime, matching createBudgetInputSchema. */
function monthInputToIso(value: string): string {
  return new Date(`${value}-01T00:00:00.000Z`).toISOString();
}

function isoToMonthInput(iso: string): string {
  return iso.slice(0, 7);
}

export function BudgetForm({
  initial,
  expenseCategories,
  defaultMonth,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: Budget;
  expenseCategories: FinanceCategory[];
  defaultMonth: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: BudgetFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? expenseCategories[0]?.id ?? "");
  const [month, setMonth] = useState(initial ? isoToMonthInput(initial.month) : defaultMonth);
  const [limitAmount, setLimitAmount] = useState(fromKopecks(initial?.limitAmount));
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const kopecks = toKopecks(limitAmount);
    if (!kopecks) {
      setError("Введите лимит больше нуля");
      return;
    }
    if (!categoryId) return;
    void onSubmit({ categoryId, month: monthInputToIso(month), limitAmount: kopecks });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {initial ? (
        <p className="text-sm text-foreground">
          {expenseCategories.find((c) => c.id === initial.categoryId)?.name ?? "Категория"} · {month}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Категория
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Месяц
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Лимит, ₽
        <Input
          inputMode="decimal"
          placeholder="0"
          value={limitAmount}
          onChange={(e) => {
            setLimitAmount(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        {error ? <span className="text-destructive">{error}</span> : null}
      </label>
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !categoryId}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
