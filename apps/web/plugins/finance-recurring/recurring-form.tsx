"use client";

import type { Account, FinanceCategory, RecurrenceInterval, RecurringTransaction, TransactionType } from "@orion/shared-types";
import { Button, Input, Select, Textarea } from "@orion/ui";
import { useMemo, useState, type FormEvent } from "react";
import { fromKopecks, toKopecks } from "../../lib/extensions/host-api";

export interface RecurringFormValues {
  accountId: string;
  categoryId: string | null;
  type: TransactionType;
  amount: number;
  note: string;
  interval: RecurrenceInterval;
  anchorDay: number;
  nextRunAt: string;
}

const WEEKDAY_LABEL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

/** First occurrence at/after today, noon local time (avoids any midnight-boundary timezone surprise for a date that otherwise carries no meaningful time-of-day). */
function computeFirstRun(interval: RecurrenceInterval, anchorDay: number): Date {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  if (interval === "weekly") {
    const currentWeekday = (candidate.getDay() + 6) % 7; // 0 = Monday
    const diff = (anchorDay - currentWeekday + 7) % 7;
    candidate.setDate(candidate.getDate() + diff);
    return candidate;
  }
  const daysInThisMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
  candidate.setDate(Math.min(anchorDay, daysInThisMonth));
  if (candidate.getTime() < now.getTime()) {
    const next = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 1, 12, 0, 0, 0);
    const daysInNextMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(anchorDay, daysInNextMonth));
    return next;
  }
  return candidate;
}

export function RecurringForm({
  initial,
  accounts,
  categories,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: RecurringTransaction;
  accounts: Account[];
  categories: FinanceCategory[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: RecurringFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [amount, setAmount] = useState(fromKopecks(initial?.amount));
  const [note, setNote] = useState(initial?.note ?? "");
  const [interval, setInterval] = useState<RecurrenceInterval>(initial?.interval ?? "monthly");
  const [anchorDay, setAnchorDay] = useState(initial?.anchorDay ?? 1);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(() => categories.filter((c) => c.kind === type), [categories, type]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const kopecks = toKopecks(amount);
    if (!kopecks) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (!accountId) return;
    void onSubmit({
      accountId,
      categoryId: categoryId || null,
      type,
      amount: kopecks,
      note,
      interval,
      anchorDay,
      nextRunAt: initial?.nextRunAt ?? computeFirstRun(interval, anchorDay).toISOString()
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-white/[0.02] p-1">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setType(t);
              setCategoryId("");
            }}
            className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
              type === t ? (t === "expense" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success") : "text-muted-foreground"
            }`}
          >
            {t === "expense" ? "Расход" : "Доход"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Сумма, ₽
        <Input
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        {error ? <span className="text-destructive">{error}</span> : null}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
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
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Категория
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Без категории</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Периодичность
          <Select
            value={interval}
            onChange={(e) => {
              const next = e.target.value as RecurrenceInterval;
              setInterval(next);
              setAnchorDay(next === "weekly" ? 0 : 1);
            }}
          >
            <option value="monthly">Ежемесячно</option>
            <option value="weekly">Еженедельно</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          {interval === "weekly" ? "День недели" : "Число месяца"}
          {interval === "weekly" ? (
            <Select value={anchorDay} onChange={(e) => setAnchorDay(Number(e.target.value))}>
              {WEEKDAY_LABEL.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              type="number"
              min={1}
              max={28}
              value={anchorDay}
              onChange={(e) => setAnchorDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
            />
          )}
        </label>
      </div>

      <Textarea placeholder="Заметка (необязательно)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !accountId}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
