"use client";

import { PROJECT_STATUS_ORDER, type Project, type ProjectStatus } from "@orion/shared-types";
import { Button, Input, PALETTE_SWATCHES, Select, Textarea } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { fromKopecks, parseMoneyInput } from "../lib/format";

/**
 * Project create/edit form — split out of ProjectsPanel.tsx for the same
 * reason task-form.tsx was (see CLAUDE.md: a file over ~400 lines with two
 * independent concerns gets cut). It is rendered both in the "Новый проект"
 * Modal and in the detail Sheet's "Изменить" Modal, so it owns no chrome.
 */

export { PROJECT_STATUS_ORDER };

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Активный",
  on_hold: "На паузе",
  completed: "Завершён"
};

/**
 * Six curated palette slots (`c0`..`c5`) — the very keys the calendar's
 * swatch picker stores (PALETTE_SWATCHES, ten hues picked for AA contrast on
 * the dark card). No raw hex here on purpose: the colour is a key, and the
 * fill is resolved from the shared palette so a project reads the same in the
 * calendar, on the board and in this form.
 */
export const PROJECT_COLOR_ORDER = PALETTE_SWATCHES.slice(0, 6).map((swatch) => swatch.key);

/** Palette key → fill, for the colour dot on a project card. */
export function projectSwatchColor(key: string | null | undefined): string | undefined {
  return key ? PALETTE_SWATCHES.find((swatch) => swatch.key === key)?.color : undefined;
}

/** Same five codes the account form offers — ORION never converts between them. */
export const PROJECT_CURRENCY_ORDER = ["RUB", "USD", "EUR", "KZT", "BYN"] as const;
const PROJECT_CURRENCY_LABEL: Record<string, string> = {
  RUB: "₽ Рубль",
  USD: "$ Доллар",
  EUR: "€ Евро",
  KZT: "₸ Тенге",
  BYN: "Br Белорусский рубль"
};

export interface ProjectFormValues {
  name: string;
  description: string;
  status: ProjectStatus;
  color: string | null;
  startAt: string | null;
  dueAt: string | null;
  budgetAmount: number | null;
  /** Копейки за час; null = ставка не задана (стоимость времени тогда не считается). */
  hourlyRate: number | null;
  currency: string;
}

/* `<input type="date">` speaks local wall-clock days, the API speaks ISO
   instants — the same two-way conversion event-form.tsx does for all-day
   events: midnight local, so "1 сентября" stays 1 сентября in the UI. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateInput(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}

export function ProjectForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: Project;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: ProjectFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "active");
  const [color, setColor] = useState(initial?.color ?? "");
  const [startAt, setStartAt] = useState(toDateInput(initial?.startAt ?? null));
  const [dueAt, setDueAt] = useState(toDateInput(initial?.dueAt ?? null));
  const [budget, setBudget] = useState(fromKopecks(initial?.budgetAmount ?? undefined));
  // Rubles per hour in the field, kopecks per hour on the wire — same boundary
  // the budget crosses, and an empty field stays null instead of becoming 0.
  const [rate, setRate] = useState(fromKopecks(initial?.hourlyRate ?? undefined));
  const [currency, setCurrency] = useState(initial?.currency ?? "RUB");
  const [error, setError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;

    // Empty budget means "не задан" (null) — not zero, so the card can tell
    // "бюджет не задан" from "бюджет 0".
    let budgetAmount: number | null = null;
    if (budget.trim()) {
      const kopecks = parseMoneyInput(budget);
      if (kopecks === null || kopecks < 0) {
        setError("Введите бюджет числом, без минуса");
        return;
      }
      budgetAmount = kopecks;
    }

    // Same rule for the hourly rate: пусто = ставка не задана (null), а не 0 ₽/час.
    let hourlyRate: number | null = null;
    if (rate.trim()) {
      const kopecks = parseMoneyInput(rate);
      if (kopecks === null || kopecks < 0) {
        setRateError("Введите ставку числом, без минуса");
        return;
      }
      hourlyRate = kopecks;
    }

    void onSubmit({
      name: name.trim(),
      description,
      status,
      color: color || null,
      startAt: fromDateInput(startAt),
      dueAt: fromDateInput(dueAt),
      budgetAmount,
      hourlyRate,
      currency
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        placeholder="Название проекта"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        required
        autoFocus
      />
      <Textarea
        placeholder="Описание (необязательно)"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Статус
          <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {PROJECT_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Валюта
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {PROJECT_CURRENCY_ORDER.map((code) => (
              <option key={code} value={code}>
                {PROJECT_CURRENCY_LABEL[code] ?? code}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Начало
          <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Срок
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Бюджет, {currency}
          <Input
            inputMode="decimal"
            placeholder="Без бюджета"
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value);
              setError(null);
            }}
          />
          {error ? <span className="text-destructive">{error}</span> : null}
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Ставка, {currency}/час
          <Input
            inputMode="decimal"
            placeholder="Без ставки"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setRateError(null);
            }}
          />
          {rateError ? <span className="text-destructive">{rateError}</span> : null}
        </label>
      </div>

      <p className="-mt-1 text-2xs text-subtle-foreground">
        По ставке считается стоимость учтённого времени; пусто — стоимость не считается.
      </p>

      <div className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Цвет
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setColor("")}
            aria-label="без цвета"
            className={
              color === ""
                ? "h-5 w-5 rounded-full border-2 border-accent text-2xs text-muted-foreground"
                : "h-5 w-5 rounded-full border border-border text-2xs text-muted-foreground"
            }
          >
            ×
          </button>
          {PROJECT_COLOR_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`цвет ${key}`}
              onClick={() => setColor(key)}
              style={{ backgroundColor: projectSwatchColor(key) }}
              className={
                color === key
                  ? "h-5 w-5 rounded-full ring-2 ring-accent ring-offset-1 ring-offset-card"
                  : "h-5 w-5 rounded-full"
              }
            />
          ))}
        </div>
      </div>

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
