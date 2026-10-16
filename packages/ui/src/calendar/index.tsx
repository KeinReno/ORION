"use client";

import clsx from "clsx";
import { CalendarSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SegmentedControl } from "../primitives";
import { Agenda } from "./agenda";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";
import {
  addDays,
  MONTH_LABELS,
  MONTH_SHORT,
  startOfWeek,
  type CalendarItem,
  type CalendarView,
  type ItemContextHandler,
  type ReschedulePayload,
  type SlotCreatePayload
} from "./shared";

export type {
  ItemContextHandler,
  CalendarItem,
  CalendarView,
  ReschedulePayload,
  SlotCreatePayload
} from "./shared";
export { PALETTE_SWATCHES, calendarItemMode, toneStyle } from "./shared";

export interface CalendarProps {
  items: CalendarItem[];
  view?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  onItemClick?: (id: string) => void;
  /** Right click / Menu key / Shift+F10 on a grid item. The consumer owns the menu; Calendar knows no domain commands. */
  onItemContextMenu?: ItemContextHandler;
  /** Move or resize — time-grid views send `end`, month/agenda send only `start`. */
  onItemReschedule?: (id: string, payload: ReschedulePayload) => void;
  /** Empty slot picked — a day (month) or a time range (week/day). */
  onSlotCreate?: (payload: SlotCreatePayload) => void;
  /**
   * Fires whenever the visible window changes (view switch, prev/next,
   * "today") with a padded `[from, to)` — the consumer feeds it to a
   * windowed `useEvents(range)` query. Padded so an edge drag and
   * recurrence expansion have margin.
   */
  onRangeChange?: (range: { from: string; to: string }) => void;
  /** Rendered between the period label and the view switch — e.g. source toggles. */
  headerExtra?: ReactNode;
  /** Keyboard-focused pill (↑/↓ in the panel). Distinct from the open Sheet. */
  focusedId?: string | null;
  /** Optional sibling controls in the roomy agenda rows. Grids keep their compact interaction. */
  renderAgendaItemActions?: (item: CalendarItem) => ReactNode;
}

const VIEW_OPTIONS = [
  { value: "month" as const, label: "Месяц" },
  { value: "week" as const, label: "Неделя" },
  { value: "day" as const, label: "День" },
  { value: "agenda" as const, label: "Список" }
];

export function Calendar({
  items,
  view: controlledView,
  onViewChange,
  onItemClick,
  onItemContextMenu,
  onItemReschedule,
  onSlotCreate,
  onRangeChange,
  headerExtra,
  focusedId,
  renderAgendaItemActions
}: CalendarProps): React.ReactElement {
  const [cursor, setCursor] = useState(() => new Date());
  const [uncontrolledView, setUncontrolledView] = useState<CalendarView>("month");
  const view = controlledView ?? uncontrolledView;
  const today = new Date();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const range = useMemo(() => {
    let from: Date;
    let to: Date;
    if (view === "month") {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      from = addDays(startOfWeek(first), -7);
      to = addDays(from, 8 * 7);
    } else if (view === "agenda") {
      from = addDays(new Date(), -1);
      to = addDays(from, 62);
    } else {
      const start = view === "day" ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()) : startOfWeek(cursor);
      from = addDays(start, -7);
      to = addDays(start, view === "day" ? 8 : 14);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }, [cursor, view]);

  useEffect(() => {
    onRangeChange?.(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  function openDatePicker(): void {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  const setView = (v: CalendarView): void => {
    setUncontrolledView(v);
    onViewChange?.(v);
  };

  function shift(direction: number): void {
    if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
    else if (view === "week" || view === "agenda") setCursor(addDays(cursor, direction * 7));
    else setCursor(addDays(cursor, direction));
  }

  const days = useMemo(() => {
    if (view === "day") return [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())];
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [cursor, view]);

  const periodLabel = useMemo(() => {
    if (view === "month") return `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`;
    if (view === "day")
      return cursor.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    if (view === "agenda") return "Ближайшее";
    const s = startOfWeek(cursor);
    const e = addDays(s, 6);
    return `${s.getDate()} ${MONTH_SHORT[s.getMonth()]} — ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`;
  }, [cursor, view]);

  return (
    <div
      className={clsx("rounded-2xl border border-border bg-card p-3", view === "month" && "flex flex-1 flex-col")}
      role="group"
      aria-label="Календарь"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowLeft") shift(-1);
        else if (e.key === "ArrowRight") shift(1);
        else if (e.key.toLowerCase() === "t") setCursor(new Date());
        else if (e.key === "1") setView("month");
        else if (e.key === "2") setView("week");
        else if (e.key === "3") setView("day");
        else if (e.key === "4") setView("agenda");
      }}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Назад"
            className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            Сегодня
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Вперёд"
            className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            →
          </button>
          <button
            type="button"
            onClick={openDatePicker}
            aria-label="Перейти к дате"
            title="Перейти к дате"
            className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <CalendarSearch className="h-3.5 w-3.5" />
          </button>
          <input
            ref={dateInputRef}
            type="date"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={(e) => {
              const [y, m, d] = e.target.value.split("-").map(Number);
              if (y && m && d) setCursor(new Date(y, m - 1, d));
              e.target.value = "";
            }}
          />
          <span className="ml-2 text-sm font-medium capitalize text-foreground" aria-live="polite">
            {periodLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          {/* Never let the view switch be squeezed into a column when the source chips wrap. */}
          <div className="shrink-0">
            <SegmentedControl<CalendarView> value={view} onChange={setView} options={VIEW_OPTIONS} />
          </div>
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid
          cursor={cursor}
          today={today}
          items={items}
          onItemClick={onItemClick}
          onItemContextMenu={onItemContextMenu}
          onItemReschedule={onItemReschedule}
          onSlotCreate={onSlotCreate}
          focusedId={focusedId}
        />
      ) : view === "agenda" ? (
        <Agenda items={items} onItemClick={onItemClick} focusedId={focusedId} renderItemActions={renderAgendaItemActions} />
      ) : (
        <TimeGrid
          days={days}
          today={today}
          items={items}
          onItemClick={onItemClick}
          onItemContextMenu={onItemContextMenu}
          onItemReschedule={onItemReschedule}
          onSlotCreate={onSlotCreate}
          focusedId={focusedId}
        />
      )}
    </div>
  );
}
