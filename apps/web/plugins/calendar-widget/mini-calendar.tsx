"use client";

import { useEvents, useTasks } from "@orion/core-react";
import { isTaskClosed } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import { buildMiniMonth, markDays, miniMonthRange } from "./mini-month";
import type { SidebarWidgetSlotProps } from "../../lib/extensions/contracts";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const COLLAPSED_KEY = "orion.mini-calendar-collapsed";
const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });

/**
 * A compact month for the sidebar: dots mark days that have events (accent) or open tasks
 * due (warm). It reads the same API as the calendar panel; a click opens the calendar.
 * Not drawn in the collapsed rail — there is no room for a month in 60px.
 */
export function MiniCalendarWidget({ workspaceId, open, onOpenCalendar }: SidebarWidgetSlotProps): React.ReactElement | null {
  const today = new Date();
  // Tall sidebars have room for the month; on a short window it starts folded to one line.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved === "1" || saved === "0") return saved === "1";
    } catch {
      /* a remembered fold is a convenience only */
    }
    return window.innerHeight < 1000;
  });
  function toggleCollapsed(): void {
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !current;
    });
  }
  const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));
  const cells = useMemo(() => buildMiniMonth(cursor.year, cursor.month, new Date()), [cursor.year, cursor.month]);
  const range = useMemo(() => miniMonthRange(cells), [cells]);
  const { data: events } = useEvents(open && !collapsed ? workspaceId : undefined, range);
  const { data: tasks } = useTasks(open && !collapsed ? workspaceId : undefined);
  const marks = useMemo(
    () => markDays(events ?? [], (tasks ?? []).map((task) => ({ dueAt: task.dueAt, closed: isTaskClosed(task.status) }))),
    [events, tasks]
  );

  if (!open) return null;

  function shift(delta: number): void {
    setCursor((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={false}
        className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-muted-foreground first-letter:uppercase transition-colors hover:bg-white/5 hover:text-foreground"
      >
        {MONTH_FORMAT.format(new Date(cursor.year, cursor.month, 1))}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <section aria-label="Мини-календарь" className="rounded-lg border border-border px-2 py-2">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onOpenCalendar}
          className="truncate text-2xs font-medium text-foreground first-letter:uppercase hover:underline"
          title="Открыть календарь"
        >
          {MONTH_FORMAT.format(new Date(cursor.year, cursor.month, 1))}
        </button>
        <span className="flex items-center">
          <button type="button" aria-label="Свернуть календарь" aria-expanded onClick={toggleCollapsed} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Предыдущий месяц" onClick={() => shift(-1)} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Следующий месяц" onClick={() => shift(1)} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-subtle-foreground">
        {WEEKDAYS.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {cells.map((cell) => {
          const mark = marks.get(cell.key);
          return (
            <button
              key={cell.key}
              type="button"
              onClick={onOpenCalendar}
              aria-label={`${cell.key}${mark ? `: событий ${mark.events}, задач ${mark.tasks}` : ""}`}
              className={cx(
                "relative flex h-6 flex-col items-center justify-center rounded text-[11px] tabular-nums hover:bg-white/5",
                cell.inMonth ? "text-foreground" : "text-subtle-foreground/50",
                cell.isToday && "bg-accent/20 font-semibold text-accent-text"
              )}
            >
              {cell.day}
              {mark ? (
                <span className="absolute bottom-0.5 flex gap-0.5" aria-hidden>
                  {mark.events > 0 ? <span className="h-1 w-1 rounded-full bg-accent" /> : null}
                  {mark.tasks > 0 ? <span className="h-1 w-1 rounded-full bg-warning" /> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
