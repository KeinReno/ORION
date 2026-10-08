"use client";

import clsx from "clsx";
import { useMemo } from "react";
import { useResizeWidth } from "../hooks";
import { Popover } from "../overlays";
import {
  addDays,
  allDayAnchor,
  calendarItemMode,
  dateKey,
  dayToISO,
  MONTH_LABELS,
  Pill,
  sameDay,
  startOfDay,
  WEEKDAY_LABELS,
  type CalendarItem,
  type ReschedulePayload,
  type SlotCreatePayload
} from "./shared";

const MAX_SPAN_LANES = 3;
const MAX_SINGLES = 3;
/**
 * Below this grid width a day cell is ~40–70px: a pill there shows a clipped
 * time and no title. The cell then shows only a count that opens the same
 * day popover the "+N ещё" overflow already uses — the panel can be this
 * narrow in a wide window (dockview split), so it is the grid's own width
 * that decides, not a viewport breakpoint.
 */
const COMPACT_BELOW_PX = 560;

interface MonthGridProps {
  cursor: Date;
  today: Date;
  items: CalendarItem[];
  onItemClick?: (id: string) => void;
  onItemReschedule?: (id: string, payload: ReschedulePayload) => void;
  onSlotCreate?: (payload: SlotCreatePayload) => void;
  focusedId?: string | null;
}

interface Bar {
  item: CalendarItem;
  startCol: number;
  endCol: number;
  lane: number;
}

export function MonthGrid({
  cursor,
  today,
  items,
  onItemClick,
  onItemReschedule,
  onSlotCreate,
  focusedId
}: MonthGridProps): React.ReactElement {
  const weeks = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const leading = (new Date(year, month, 1).getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - leading);
    return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)));
  }, [cursor]);
  const [gridRef, gridWidth] = useResizeWidth<HTMLDivElement>();
  const compact = gridWidth > 0 && gridWidth < COMPACT_BELOW_PX;

  return (
    // The month fills the card's height (the card itself grows with the panel),
    // so the six weeks share the space instead of leaving an empty tail below.
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="grid grid-cols-7 gap-1 text-center text-2xs text-subtle-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>
      <div ref={gridRef} className="flex flex-1 flex-col gap-1">
        {weeks.map((week) => (
          <WeekRow
            key={dateKey(week[0])}
            week={week}
            month={cursor.getMonth()}
            today={today}
            items={items}
            onItemClick={onItemClick}
            onItemReschedule={onItemReschedule}
            onSlotCreate={onSlotCreate}
            focusedId={focusedId}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  week,
  month,
  today,
  items,
  onItemClick,
  onItemReschedule,
  onSlotCreate,
  focusedId,
  compact
}: {
  week: Date[];
  month: number;
  today: Date;
  compact: boolean;
} & Pick<MonthGridProps, "items" | "onItemClick" | "onItemReschedule" | "onSlotCreate" | "focusedId">): React.ReactElement {
  const weekStartMs = startOfDay(week[0]).getTime();
  const weekEndMs = weekStartMs + 7 * 86_400_000;

  const { bars, singlesByCol } = useMemo(() => {
    const spanning: { item: CalendarItem; startCol: number; endCol: number }[] = [];
    const singles: CalendarItem[][] = Array.from({ length: 7 }, () => []);

    for (const item of items) {
      // All-day items carry a date-only contract (UTC-midnight boundaries) —
      // anchor them to the viewer's local midnight before bucketing so the
      // pill lands on the calendar date it actually means (see allDayAnchor).
      const start = item.allDay ? allDayAnchor(item.start) : new Date(item.start);
      const sMs = startOfDay(start).getTime();
      const rawEnd = item.end ? (item.allDay ? allDayAnchor(item.end) : new Date(item.end)) : start;
      const lastDayMs = startOfDay(new Date(rawEnd.getTime() - 1)).getTime(); // exclusive end
      if (lastDayMs < weekStartMs || sMs >= weekEndMs) continue;

      if (lastDayMs <= sMs) {
        const col = Math.round((Math.max(sMs, weekStartMs) - weekStartMs) / 86_400_000);
        singles[col].push(item);
        continue;
      }
      const startCol = Math.max(0, Math.round((sMs - weekStartMs) / 86_400_000));
      const endCol = Math.min(6, Math.round((lastDayMs - weekStartMs) / 86_400_000));
      spanning.push({ item, startCol, endCol });
    }

    spanning.sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol);
    for (const col of singles) col.sort((a, b) => a.start.localeCompare(b.start));

    const laneEnds: number[] = [];
    const placed: Bar[] = [];
    for (const seg of spanning) {
      let lane = laneEnds.findIndex((end) => end < seg.startCol);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(seg.endCol);
      } else {
        laneEnds[lane] = seg.endCol;
      }
      placed.push({ ...seg, lane });
    }
    return { bars: placed, singlesByCol: singles };
  }, [items, weekStartMs, weekEndMs]);

  const laneCount = Math.min(MAX_SPAN_LANES, bars.reduce((m, b) => Math.max(m, b.lane + 1), 0));

  return (
    <div className="flex flex-1 flex-col gap-1">
      {/* multi-day ribbon band — its own 7-col grid so a bar spans real columns */}
      {laneCount > 0 ? (
        <div
          className="grid grid-cols-7 gap-1"
          style={{ gridTemplateRows: `repeat(${laneCount}, 18px)` }}
        >
          {bars
            .filter((b) => b.lane < MAX_SPAN_LANES)
            .map((b) => (
              <div
                key={b.item.id}
                style={{ gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`, gridRow: b.lane + 1 }}
              >
                <Pill
                  item={b.item}
                  onClick={onItemClick}
                  focused={b.item.id === focusedId}
                  draggable={Boolean(onItemReschedule) && calendarItemMode(b.item) !== "none"}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", b.item.id)}
                />
              </div>
            ))}
        </div>
      ) : null}

      {/* day cells */}
      <div className="grid flex-1 grid-cols-7 gap-1">
        {week.map((day, col) => {
          const inMonth = day.getMonth() === month;
          const singles = singlesByCol[col];
          const shown = compact ? 0 : MAX_SINGLES;
          const overflow = Math.max(0, singles.length - shown);
          return (
            <div
              key={dateKey(day)}
              onDragOver={(e) => onItemReschedule && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                if (id) onItemReschedule?.(id, { start: dayToISO(day), originX: e.clientX, originY: e.clientY });
              }}
              onClick={() => onSlotCreate?.({ start: dayToISO(day), allDay: false })}
              className={clsx(
                "group min-h-[64px] rounded-lg border p-1 text-left align-top transition-colors",
                onSlotCreate && "cursor-pointer",
                sameDay(day, today) ? "border-accent/40 bg-accent/[0.06]" : "border-white/5 hover:border-border",
                !inMonth && "opacity-40"
              )}
            >
              <div className="mb-0.5 flex items-center justify-between">
                <span
                  className={clsx(
                    "text-2xs",
                    sameDay(day, today) ? "font-semibold text-accent" : "text-subtle-foreground"
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {singles.slice(0, shown).map((item) => (
                  <Pill
                    key={item.id}
                    item={item}
                    onClick={onItemClick}
                    showTime
                    focused={item.id === focusedId}
                    draggable={Boolean(onItemReschedule) && calendarItemMode(item) !== "none"}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)}
                  />
                ))}
                {overflow > 0 ? (
                  <Popover
                    align="start"
                    width={248}
                    trigger={({ toggle, ref }) => (
                      <button
                        ref={ref}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                        aria-label={compact ? `Записей: ${overflow} — показать` : undefined}
                        className={
                          compact
                            ? "w-full rounded bg-white/10 px-1 py-0.5 text-center text-2xs text-foreground/80 hover:bg-white/15"
                            : "px-1 text-left text-2xs text-muted-foreground hover:text-foreground"
                        }
                      >
                        {compact ? overflow : `+${overflow} ещё`}
                      </button>
                    )}
                  >
                    {() => (
                      <div className="flex flex-col gap-1">
                        <p className="mb-1 text-2xs font-medium text-subtle-foreground">
                          {day.getDate()} {MONTH_LABELS[day.getMonth()]}
                        </p>
                        {singles.map((item) => (
                          <Pill key={item.id} item={item} onClick={onItemClick} showTime focused={item.id === focusedId} />
                        ))}
                      </div>
                    )}
                  </Popover>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
