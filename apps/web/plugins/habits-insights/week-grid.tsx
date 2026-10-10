"use client";

import { isHabitScheduled, type Habit } from "@orion/shared-types";
import { IconButton, cx } from "@orion/ui";
import { Archive, Check } from "lucide-react";
import { WEEKDAY_SHORT, habitSwatchColor, weekdayTitle, type WeekDay } from "../../lib/habit-days";

/**
 * The week at a glance: one row per active habit, seven columns Пн…Вс.
 *
 * A cell is filled when the habit carries a tick for that day, and *dimmed* when
 * the day is off its schedule — an off-schedule tick is allowed (the API accepts
 * it, it just doesn't feed the streak), so dimming is a hint, not a lock. Today's
 * column is outlined so "where am I" needs no counting.
 *
 * Every click sends the clicked cell's own day to the toggle, never the server's
 * idea of today — that is what makes a Monday cell a Monday tick.
 */
export function WeekGrid({
  habits,
  week,
  days,
  busy,
  onToggle,
  onEdit,
  onArchive
}: {
  habits: Habit[];
  week: WeekDay[];
  days: Map<string, Set<string>>;
  busy: boolean;
  onToggle: (habitId: string, day: string) => void;
  onEdit: (habit: Habit) => void;
  onArchive: (habit: Habit) => void;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1" />
        {week.map((day) => (
          <span
            key={day.key}
            title={day.key}
            className={cx(
              "flex w-7 flex-col items-center text-2xs leading-tight",
              day.isToday ? "font-semibold text-accent-text" : "text-subtle-foreground"
            )}
          >
            {WEEKDAY_SHORT[day.weekday]}
            <span className="tabular-nums">{day.dayOfMonth}</span>
          </span>
        ))}
        <span className="w-7" />
      </div>

      {habits.map((habit) => (
        <div key={habit.id} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onEdit(habit)}
            title="Изменить привычку"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-foreground outline-none hover:text-accent-text focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {habit.color ? (
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: habitSwatchColor(habit.color) }}
              />
            ) : null}
            <span className="truncate">{habit.name}</span>
          </button>

          {week.map((day) => {
            const done = days.get(habit.id)?.has(day.key) ?? false;
            const scheduled = isHabitScheduled(habit.weekdays, day.key);
            if (!scheduled) {
              return <span key={day.key} className="h-7 w-7 shrink-0" aria-hidden />;
            }
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={done}
                aria-label={`${habit.name}: ${weekdayTitle(day.weekday)}, ${day.key} — ${
                  done ? "снять отметку" : "отметить"
                }`}
                disabled={busy}
                onClick={() => onToggle(habit.id, day.key)}
                className={cx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-[color,background-color,border-color,transform] outline-none active:scale-90",
                  "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
                  done
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border-strong hover:border-accent",
                  day.isToday && "ring-1 ring-accent/70 ring-offset-1 ring-offset-card"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            );
          })}

          <IconButton label={`Убрать «${habit.name}» в архив`} size="sm" disabled={busy} onClick={() => onArchive(habit)}>
            <Archive className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
