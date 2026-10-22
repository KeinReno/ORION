"use client";

import { EVENT_REMINDER_LIMIT, reminderOffsetMinutes } from "@orion/shared-types";
import { IconButton, Input } from "@orion/ui";
import { X } from "lucide-react";
import { useState } from "react";
import type { EventRemindersSlotProps } from "../../lib/extensions/contracts";
import { fromDatetimeLocal, toDatetimeLocal } from "../../lib/format";

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "в момент" },
  { minutes: 10, label: "за 10 мин" },
  { minutes: 30, label: "за 30 мин" },
  { minutes: 60, label: "за 1 час" },
  { minutes: 1440, label: "за 1 день" }
];

const PRESET_MINUTES = new Set(REMINDER_PRESETS.map((preset) => preset.minutes));

function fireLocal(startAt: string, offsetMinutes: number): string {
  const start = new Date(startAt).getTime();
  if (!Number.isFinite(start)) return "";
  return toDatetimeLocal(new Date(start - offsetMinutes * 60_000).toISOString());
}

function lead(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes);
  const span = abs % 1440 === 0 ? `${abs / 1440} дн.` : abs % 60 === 0 ? `${abs / 60} ч.` : `${abs} мин.`;
  if (offsetMinutes === 0) return "в момент начала";
  if (offsetMinutes > 0) return `за ${span} до начала`;
  return `через ${span} после начала`;
}

/** Plugin `calendar-reminders`: presets plus any number of chosen clock times (up to EVENT_REMINDER_LIMIT). */
export function EventReminderFields({ value, onChange, startAt }: EventRemindersSlotProps): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const custom = value.filter((minutes) => !PRESET_MINUTES.has(minutes));
  const full = value.length >= EVENT_REMINDER_LIMIT;

  function togglePreset(minutes: number): void {
    setError(null);
    onChange(value.includes(minutes) ? value.filter((item) => item !== minutes) : [...value, minutes]);
  }

  function addOwnTime(): void {
    setError(null);
    if (full) return;
    for (let step = 0; step < 48; step += 1) {
      const candidate = 15 + step * 15;
      if (!value.includes(candidate)) {
        onChange([...value, candidate]);
        return;
      }
    }
  }

  function setCustom(previous: number, localValue: string): void {
    const fireAt = fromDatetimeLocal(localValue);
    const next = fireAt === null ? null : reminderOffsetMinutes(new Date(startAt).getTime(), new Date(fireAt).getTime());
    if (next === null) {
      setError("Это время слишком далеко от начала: не раньше 4 недель и не позже 7 дней.");
      return;
    }
    setError(null);
    if (next === previous) return;
    if (value.includes(next)) {
      onChange(value.filter((item) => item !== previous));
      return;
    }
    onChange(value.map((item) => (item === previous ? next : item)));
  }

  function removeCustom(minutes: number): void {
    setError(null);
    onChange(value.filter((item) => item !== minutes));
  }

  return (
    <fieldset className="rounded-lg border border-border p-2.5">
      <legend className="px-1 text-2xs text-subtle-foreground">Напоминания</legend>
      <div className="flex flex-wrap gap-1">
        {REMINDER_PRESETS.map((preset) => (
          <button
            key={preset.minutes}
            type="button"
            disabled={!value.includes(preset.minutes) && full}
            onClick={() => togglePreset(preset.minutes)}
            className={
              value.includes(preset.minutes)
                ? "rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-2xs text-accent-text"
                : "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      {custom.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {custom.map((minutes) => (
            <li key={minutes} className="flex items-center gap-2">
              <Input
                type="datetime-local"
                aria-label={`Своё время напоминания, ${lead(minutes)}`}
                value={fireLocal(startAt, minutes)}
                onChange={(event) => setCustom(minutes, event.target.value)}
                className="max-w-[16rem]"
              />
              <span className="min-w-0 flex-1 truncate text-2xs text-subtle-foreground">{lead(minutes)}</span>
              <IconButton label="Убрать это напоминание" size="sm" tone="danger" onClick={() => removeCustom(minutes)}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        disabled={full || !Number.isFinite(new Date(startAt).getTime())}
        onClick={addOwnTime}
        className="mt-2 text-2xs text-accent-text hover:underline disabled:opacity-40"
      >
        Добавить своё время
      </button>
      {error ? <p className="mt-1 text-2xs text-destructive">{error}</p> : null}
      <p className="mt-1.5 text-2xs text-subtle-foreground">
        Можно несколько, в том числе в указанный час. Придут в Telegram (или в консоль без токена) — окно приложения открывать не нужно.
      </p>
    </fieldset>
  );
}
