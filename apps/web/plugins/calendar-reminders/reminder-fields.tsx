"use client";

import type { EventRemindersSlotProps } from "../../lib/extensions/contracts";

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "в момент" },
  { minutes: 10, label: "за 10 мин" },
  { minutes: 30, label: "за 30 мин" },
  { minutes: 60, label: "за 1 час" },
  { minutes: 1440, label: "за 1 день" }
];

/** Plugin `calendar-reminders`: the «Напоминания» section of the event form (offsets in minutes before the start). */
export function EventReminderFields({ value, onChange }: EventRemindersSlotProps): React.ReactElement {
  return (
    <fieldset className="rounded-lg border border-border p-2.5">
      <legend className="px-1 text-2xs text-subtle-foreground">Напоминания</legend>
      <div className="flex flex-wrap gap-1">
        {REMINDER_PRESETS.map((preset) => (
          <button
            key={preset.minutes}
            type="button"
            onClick={() => onChange(value.includes(preset.minutes) ? value.filter((m) => m !== preset.minutes) : [...value, preset.minutes])}
            className={
              value.includes(preset.minutes)
                ? "rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-2xs text-accent-text"
                : "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-2xs text-subtle-foreground">
        Придут в Telegram (или в консоль без токена) — окно приложения открывать не нужно.
      </p>
    </fieldset>
  );
}
