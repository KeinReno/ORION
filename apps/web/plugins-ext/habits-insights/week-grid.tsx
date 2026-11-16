"use client";

import { isHabitScheduled, type Habit } from "@orion/shared-types";
import { IconButton, cx, useResizeWidth } from "@orion/ui";
import { Archive, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { WEEKDAY_SHORT, habitSwatchColor, weekdayTitle, type WeekDay } from "../../lib/extensions/host-api";

/**
 * The week at a glance: one row per active habit, seven columns Пн…Вс.
 *
 * A cell is filled when the habit carries a tick for that day, and *dimmed* when
 * the day is off its schedule — an off-schedule tick is allowed (the API accepts
 * it, it just doesn't feed the streak), so a dimmed cell is still clickable: the
 * user who actually did the thing on a rest day must be able to record it.
 * Today's column is outlined so "where am I" needs no counting.
 *
 * The grid can be paged back through past weeks (`weekOffset`/`onWeekOffsetChange`),
 * so a tick forgotten on Tuesday can land on Tuesday of any previous week — the
 * whole point of the grid is that the API takes any day, not just today.
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
  onArchive,
  weekOffset = 0,
  onWeekOffsetChange
}: {
  habits: Habit[];
  week: WeekDay[];
  days: Map<string, Set<string>>;
  busy: boolean;
  onToggle: (habitId: string, day: string) => void;
  onEdit: (habit: Habit) => void;
  onArchive: (habit: Habit) => void;
  /** 0 = the week containing today; 1 = last week, and so on. */
  weekOffset?: number;
  onWeekOffsetChange?: (delta: -1 | 1) => void;
}): React.ReactElement {
  const [gridRef, gridWidth] = useResizeWidth<HTMLDivElement>();
  const compact = gridWidth > 0 && gridWidth < 400;
  return (
    <div ref={gridRef} className="space-y-1.5">
      <div className={cx("flex items-center gap-1.5", compact && "justify-between px-2")}>
        {onWeekOffsetChange ? (
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <IconButton label="Предыдущая неделя" size="sm" disabled={busy} onClick={() => onWeekOffsetChange(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </IconButton>
            <span className="min-w-0 flex-1 truncate text-2xs text-subtle-foreground" title={weekOffset === 0 ? undefined : `неделя с ${week[0]!.key}`}>
              {weekOffset === 0 ? "эта неделя" : `с ${week[0]!.key.slice(8)}.${week[0]!.key.slice(5, 7)}`}
            </span>
            <IconButton label="Следующая неделя" size="sm" disabled={busy || weekOffset === 0} onClick={() => onWeekOffsetChange(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
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
        <div
          key={habit.id}
          className={cx("flex items-center gap-1.5", compact && "flex-col items-stretch rounded-lg border border-border/60 px-2 py-2")}
        >
          <button
            type="button"
            onClick={() => onEdit(habit)}
            title="Изменить привычку"
            className={cx(
              "flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-foreground outline-none hover:text-accent-text focus-visible:ring-2 focus-visible:ring-accent/60",
              compact && "w-full"
            )}
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

          <div className={compact ? "flex items-center justify-between gap-1" : "contents"}>
            {week.map((day) => {
              const done = days.get(habit.id)?.has(day.key) ?? false;
              const scheduled = isHabitScheduled(habit.weekdays, day.key);
              if (!scheduled) {
                // Off schedule: the tick is allowed and simply doesn't feed the
                // streak — a dashed dimmed cell, still clickable (backdating a
                // rest day the user actually worked through).
                return (
                  <button
                    key={day.key}
                    type="button"
                    aria-pressed={done}
                    aria-label={`${habit.name}: ${weekdayTitle(day.weekday)}, ${day.key} — вне расписания, ${done ? "снять отметку" : "отметить"}`}
                    title="Вне расписания — в серию не пойдёт"
                    disabled={busy}
                    onClick={() => onToggle(habit.id, day.key)}
                    className={cx(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed text-subtle-foreground/60 transition-[color,background-color,border-color,transform] outline-none hover:border-accent/60 hover:text-accent active:scale-90",
                      "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
                      done ? "border-accent/70 bg-accent/15 text-accent" : "border-border"
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                );
              }
              return (
                <button
                  key={day.key}
                  type="button"
                  aria-pressed={done}
                  aria-label={`${habit.name}: ${weekdayTitle(day.weekday)}, ${day.key} — ${done ? "снять отметку" : "отметить"}`}
                  disabled={busy}
                  onClick={() => onToggle(habit.id, day.key)}
                  className={cx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-[color,background-color,border-color,transform] outline-none active:scale-90",
                    "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50",
                    done ? "border-accent bg-accent text-accent-foreground" : "border-border-strong hover:border-accent",
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
        </div>
      ))}
    </div>
  );
}
