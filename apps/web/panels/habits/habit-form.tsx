"use client";

import type { Habit } from "@orion/shared-types";
import { Button, Input, PALETTE_SWATCHES, Textarea, cx } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { WEEKDAY_SHORT } from "./week";

/**
 * Habit create form lives in a Modal; the detail workspace (week, heatmap,
 * edit fields, archive) is a Sheet — same split as Tasks / Inventory.
 */

/**
 * Six curated palette slots (`c0`..`c5`) — the very keys the calendar's swatch
 * picker and the project form store. No raw hex here on purpose: the colour is a
 * key, and the fill comes from the shared palette (see `project-form.tsx`).
 */
export const HABIT_COLOR_ORDER = PALETTE_SWATCHES.slice(0, 6).map((swatch) => swatch.key);

/** Palette key → fill, for the dot next to a habit's name. */
export function habitSwatchColor(key: string | null | undefined): string | undefined {
  return key ? PALETTE_SWATCHES.find((swatch) => swatch.key === key)?.color : undefined;
}

export interface HabitFormValues {
  name: string;
  note: string;
  /** 0 = Monday … 6 = Sunday; empty means "every day" (see the hint under the toggles). */
  weekdays: number[];
  color: string | null;
}

export function HabitForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: Habit;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: HabitFormValues) => void | Promise<void>;
  onCancel: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
  const [color, setColor] = useState(initial?.color ?? "");

  function toggleDay(day: number): void {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b)
    );
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    void onSubmit({ name: name.trim(), note, weekdays, color: color || null });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        placeholder="Название привычки"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={120}
        required
        autoFocus
      />
      <Textarea
        placeholder="Заметка (необязательно)"
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-subtle-foreground">Расписание</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {WEEKDAY_SHORT.map((label, day) => {
            const active = weekdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                aria-label={label}
                onClick={() => toggleDay(day)}
                className={cx(
                  "h-8 w-8 rounded-lg border text-xs font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-accent/60",
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="text-2xs text-muted-foreground">
          {weekdays.length === 0
            ? "Ничего не выбрано — значит каждый день"
            : `Отмеченные дни: ${weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ")}`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs text-subtle-foreground">Цвет</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setColor("")}
            aria-label="Без цвета"
            title="Без цвета"
            className={cx(
              "h-5 w-5 rounded-full border",
              color === "" ? "border-2 border-accent" : "border-border"
            )}
          />
          {HABIT_COLOR_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`цвет ${key}`}
              onClick={() => setColor(key)}
              style={{ backgroundColor: habitSwatchColor(key) }}
              className={cx(
                "h-5 w-5 rounded-full",
                color === key && "ring-2 ring-accent ring-offset-1 ring-offset-card"
              )}
            />
          ))}
        </div>
      </div>

      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()} title={!name.trim() ? "Введите название" : undefined}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
