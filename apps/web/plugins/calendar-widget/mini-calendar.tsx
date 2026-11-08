"use client";

import { useEvents, useTasks } from "@orion/core-react";
import { isTaskClosed } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  calendarCapPx,
  parseSavedCalendarMode,
  pickCalendarMode,
  type CalendarMode
} from "./calendar-mode";
import { buildMiniMonth, currentWeekCells, markDays, miniMonthRange, type DayMarks, type MiniMonthCell } from "./mini-month";
import type { SidebarWidgetSlotProps } from "../../lib/extensions/contracts";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MODE_KEY = "orion.mini-calendar-mode";
const LEGACY_KEY = "orion.mini-calendar-collapsed";
const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const DAY_FORMAT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

function readSavedMode(): CalendarMode | null {
  try {
    return parseSavedCalendarMode(localStorage.getItem(MODE_KEY), localStorage.getItem(LEGACY_KEY));
  } catch {
    return null;
  }
}

function writeSavedMode(next: CalendarMode | null): void {
  try {
    if (next && next !== "full") localStorage.setItem(MODE_KEY, next);
    else localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* a remembered size is a convenience only */
  }
}

/**
 * Sidebar calendar. The mode follows the height this element may use (about 30% of the
 * sidebar), not the window. A saved preference can only ask for a smaller mode.
 * Not drawn in the collapsed rail — there is no room for a month in 60px.
 */
export function MiniCalendarWidget({ workspaceId, open, onOpenCalendar }: SidebarWidgetSlotProps): React.ReactElement | null {
  const rootRef = useRef<HTMLElement | null>(null);
  const [space, setSpace] = useState(0);
  const [saved, setSaved] = useState<CalendarMode | null>(readSavedMode);
  const [today] = useState(() => new Date());
  const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!open || !el) return;
    // The footer sizes to its content, so this element's box follows the mode already
    // chosen. The space it may use is the cap: about 30% of the parent sidebar.
    // Percentage max-height does not resolve there. ResizeObserver watches this
    // element and the sidebar so the cap tracks the real sidebar height.
    const measure = (): void => {
      const sidebar = el.closest("aside");
      const cap = sidebar ? calendarCapPx(sidebar.clientHeight) : 0;
      const own = el.getBoundingClientRect().height;
      const next = Math.round(cap > 0 ? cap : own);
      setSpace((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const sidebar = el.closest("aside");
    if (sidebar) observer.observe(sidebar);
    return () => observer.disconnect();
  }, [open]);

  const mode = pickCalendarMode(space, saved);
  const fitted = pickCalendarMode(space, null);
  const monthCells = useMemo(() => buildMiniMonth(cursor.year, cursor.month, today), [cursor.year, cursor.month, today]);
  const weekCells = useMemo(() => currentWeekCells(today), [today]);
  const cells = mode === "week" ? weekCells : monthCells;
  const range = useMemo(() => miniMonthRange(cells), [cells]);
  const showMarks = open && mode !== "minimal";
  const { data: events } = useEvents(showMarks ? workspaceId : undefined, showMarks ? range : undefined);
  const { data: tasks } = useTasks(showMarks ? workspaceId : undefined);
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

  function persist(next: CalendarMode | null): void {
    setSaved(next);
    writeSavedMode(next);
  }

  function stepDown(): void {
    persist(mode === "full" ? "week" : "minimal");
  }

  function stepUp(): void {
    const order: CalendarMode[] = ["minimal", "week", "full"];
    const next = order[order.indexOf(mode) + 1];
    persist(!next || next === fitted ? null : next);
  }

  const capStyle = { maxHeight: space > 0 ? `${space}px` : "30dvh" };
  const canStepDown = mode !== "minimal";
  const canStepUp = fitted !== mode;
  const headingDate = mode === "week" ? today : new Date(cursor.year, cursor.month, 1);

  return (
    <section
      ref={rootRef}
      aria-label="Мини-календарь"
      style={capStyle}
      className={cx(
        "min-w-0 overflow-hidden rounded-lg",
        mode === "minimal" ? "flex items-center justify-between gap-1 px-2 py-1.5" : "border border-border px-2 py-2"
      )}
    >
      {mode === "minimal" ? (
        <>
          <span className="truncate text-sm text-foreground">{DAY_FORMAT.format(today)}</span>
          <span className="flex shrink-0 items-center gap-0.5">
            {canStepUp ? (
              <button type="button" aria-label="Развернуть календарь" onClick={stepUp} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenCalendar}
              title="Открыть календарь"
              className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Календарь
            </button>
          </span>
        </>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={onOpenCalendar}
              className="truncate text-2xs font-medium text-foreground first-letter:uppercase hover:underline"
              title="Открыть календарь"
            >
              {MONTH_FORMAT.format(headingDate)}
            </button>
            <span className="flex items-center">
              {canStepUp ? (
                <button type="button" aria-label="Развернуть календарь" onClick={stepUp} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {canStepDown ? (
                <button type="button" aria-label="Свернуть календарь" aria-expanded onClick={stepDown} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {mode === "full" ? (
                <>
                  <button type="button" aria-label="Предыдущий месяц" onClick={() => shift(-1)} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Следующий месяц" onClick={() => shift(1)} className="rounded p-0.5 text-subtle-foreground hover:text-foreground">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : null}
            </span>
          </div>
          <div className="grid grid-cols-7 text-center text-[10px] text-subtle-foreground">
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 text-center">
            {cells.map((cell) => (
              <DayButton key={cell.key} cell={cell} mark={marks.get(cell.key)} onOpenCalendar={onOpenCalendar} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DayButton({
  cell,
  mark,
  onOpenCalendar
}: {
  cell: MiniMonthCell;
  mark: DayMarks | undefined;
  onOpenCalendar: () => void;
}): React.ReactElement {
  return (
    <button
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
}
