"use client";

import { isHabitScheduled, type Habit } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { WEEKDAY_SHORT, weekdayTitle, type WeekDay } from "../../lib/extensions/host-api";

/** Same 5-step scale for every cell, independent of how many habits are scheduled that day. */
function levelClass(ratio: number | null): string {
  if (ratio === null) return "bg-white/[0.03]";
  if (ratio === 0) return "border border-border-strong bg-transparent";
  if (ratio < 0.5) return "bg-accent/25";
  if (ratio < 1) return "bg-accent/55";
  return "bg-accent";
}

/**
 * "Как я справлялся вообще" at a glance, complementing the current-week
 * `WeekGrid` above it — that one is precise (per habit, editable), this one is
 * wide (per day, read-only) so a long streak actually *looks* long. One cell
 * per day, aggregated across every active habit rather than one row per habit:
 * a dozen habits over 12 weeks as separate rows would be a wall, not a glance.
 *
 * A day with nothing scheduled (weekends for a weekday-only habit, or no
 * active habits at all) reads as "no data", not as a missed day — same
 * "forgiving" spirit as `habitStreak`.
 */
export function HabitsHeatmap({
  weeks,
  habits,
  days
}: {
  weeks: WeekDay[][];
  habits: Habit[];
  days: Map<string, Set<string>>;
}): React.ReactElement {
  function ratioFor(day: WeekDay): { ratio: number | null; done: number; scheduled: number; doneNames: string[] } {
    const scheduled = habits.filter((habit) => isHabitScheduled(habit.weekdays, day.key));
    if (scheduled.length === 0) return { ratio: null, done: 0, scheduled: 0, doneNames: [] };
    const doneHabits = scheduled.filter((habit) => days.get(habit.id)?.has(day.key));
    return {
      ratio: doneHabits.length / scheduled.length,
      done: doneHabits.length,
      scheduled: scheduled.length,
      doneNames: doneHabits.map((habit) => habit.name)
    };
  }

  return (
    <div className="flex items-start gap-1.5 overflow-x-auto pb-1">
      <div className="flex shrink-0 flex-col gap-1 pt-0.5">
        {WEEKDAY_SHORT.map((label, index) => (
          <span key={label} className="flex h-3 items-center text-2xs leading-none text-subtle-foreground">
            {index % 2 === 0 ? label : ""}
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        {weeks.map((week) => (
          <div key={week[0].key} className="flex flex-col gap-1">
            {week.map((day) => {
              const { ratio, done, scheduled, doneNames } = ratioFor(day);
              const dateLabel = `${weekdayTitle(day.weekday)}, ${day.key}`;
              const title =
                scheduled === 0
                  ? `${dateLabel} — по расписанию ничего нет`
                  : doneNames.length > 0
                    ? `${dateLabel} — ${done} из ${scheduled}: ${doneNames.join(", ")}`
                    : `${dateLabel} — ничего не отмечено`;
              return (
                <span
                  key={day.key}
                  title={title}
                  className={cx(
                    "h-3 w-3 rounded-[3px]",
                    levelClass(ratio),
                    day.isToday && "ring-1 ring-accent ring-offset-1 ring-offset-card"
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
