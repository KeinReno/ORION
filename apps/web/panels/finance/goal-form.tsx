"use client";

import type { Account, SavingsGoal } from "@orion/shared-types";
import { Button, Input, Select } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { fromKopecks, toKopecks } from "../../lib/format";

export interface GoalFormValues {
  name: string;
  accountId: string;
  targetAmount: number;
  targetDate: string | null;
}

export function GoalForm({
  initial,
  accounts,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: SavingsGoal;
  accounts: Account[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: GoalFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [targetAmount, setTargetAmount] = useState(fromKopecks(initial?.targetAmount));
  const [targetDate, setTargetDate] = useState(initial?.targetDate ? initial.targetDate.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    const kopecks = toKopecks(targetAmount);
    if (!kopecks) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (!accountId) return;
    void onSubmit({
      name: name.trim(),
      accountId,
      targetAmount: kopecks,
      targetDate: targetDate ? new Date(`${targetDate}T00:00:00.000Z`).toISOString() : null
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Название цели" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Счёт
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Сумма цели, ₽
          <Input
            inputMode="decimal"
            placeholder="0"
            value={targetAmount}
            onChange={(e) => {
              setTargetAmount(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Дата (необязательно)
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
      </div>
      {error ? <p className="text-2xs text-destructive">{error}</p> : null}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim() || !accountId}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
