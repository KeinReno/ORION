"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LiveDot } from "../live-dot";
import {
  addDays,
  allDayAnchor,
  allDayDateISO,
  calendarItemMode,
  dateKey,
  inAllDayBand,
  isPointItem,
  MONTH_SHORT,
  Pill,
  sameDay,
  startOfDay,
  toneStyle,
  WEEKDAY_LABELS,
  contextPoint,
  type CalendarItem,
  type ItemContextHandler,
  type ReschedulePayload,
  type SlotCreatePayload
} from "./shared";

const HOUR_PX = 36;
const GUTTER_PX = 44;
/** Narrowest readable week column. Below it the grid scrolls sideways inside itself, never the page. */
const MIN_WEEK_COL_PX = 84;
/** One line of `text-micro`. */
const LINE_PX = 14;
const SNAP_MIN = 15;
const MIN_EVENT_MIN = 15;
const DAY_MIN = 24 * 60;

interface TimeGridProps {
  /** 1 (day view) or 7 (week view) consecutive days, Monday-first. */
  days: Date[];
  today: Date;
  items: CalendarItem[];
  onItemClick?: (id: string) => void;
  onItemContextMenu?: ItemContextHandler;
  onItemReschedule?: (id: string, payload: ReschedulePayload) => void;
  onSlotCreate?: (payload: SlotCreatePayload) => void;
  focusedId?: string | null;
}

interface Positioned {
  item: CalendarItem;
  /** This day's part of the item: a timed event crossing midnight shows on every day it covers. */
  startMin: number;
  endMin: number;
  /** Began on an earlier day — this is its continuation, which neither moves nor resizes. */
  continued: boolean;
  /** Ends on a later day — resizing here would cut it to this day. */
  continues: boolean;
  lane: number;
  lanes: number;
}

interface AllDayBar {
  item: CalendarItem;
  from: number;
  to: number;
  lane: number;
}

type DragState =
  | {
      kind: "move";
      id: string;
      item: CalendarItem;
      grabMin: number;
      durationMin: number;
      dayIndex: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "resize";
      id: string;
      item: CalendarItem;
      startMin: number;
      endMin: number;
      dayIndex: number;
      originX: number;
      originY: number;
    }
  | { kind: "create"; dayIndex: number; fromMin: number; toMin: number };

function snap(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}

function minutesFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** The item's real length — across midnight too, unlike the wall-clock minutes of its end. */
function durationMinutes(item: CalendarItem): number {
  if (!item.end) return MIN_EVENT_MIN;
  return Math.max(MIN_EVENT_MIN, Math.round((new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000));
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Greedy lane packing for the timed items of one day. Each item is clipped to the day: an event from 22:00 to
 * 02:00 is 22:00–24:00 here and 00:00–02:00 on the next day, instead of a 15-minute stub on the first day only.
 */
export function layoutDay(day: Date, items: CalendarItem[]): Positioned[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const parts: Omit<Positioned, "lane" | "lanes">[] = [];
  for (const item of items) {
    if (inAllDayBand(item)) continue;
    const start = new Date(item.start);
    const end = item.end ? new Date(item.end) : null;
    if (start >= dayEnd) continue;
    if (end ? end <= dayStart : start < dayStart) continue;
    const continued = start < dayStart;
    const continues = end !== null && end > dayEnd;
    const startMin = continued ? 0 : minutesFromMidnight(item.start);
    const endMin = !end ? startMin + MIN_EVENT_MIN : end >= dayEnd ? DAY_MIN : Math.max(startMin + MIN_EVENT_MIN, minutesFromMidnight(item.end!));
    parts.push({ item, startMin, endMin: Math.max(startMin + MIN_EVENT_MIN, endMin), continued, continues });
  }
  const sorted = parts.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const active: Positioned[] = [];
  const out: Positioned[] = [];
  for (const part of sorted) {
    const { startMin } = part;
    for (let i = active.length - 1; i >= 0; i--) if (active[i].endMin <= startMin) active.splice(i, 1);
    const usedLanes = new Set(active.map((p) => p.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane++;
    const positioned: Positioned = { ...part, lane, lanes: lane + 1 };
    active.push(positioned);
    out.push(positioned);
    const lanes = Math.max(...active.map((p) => p.lane)) + 1;
    for (const p of active) p.lanes = Math.max(p.lanes, lanes);
  }
  return out;
}

/**
 * All-day row: one bar per item across the days it covers (a three-day leave is one bar, not three pills),
 * stacked in lanes like the month grid.
 */
export function layoutAllDay(days: Date[], items: CalendarItem[]): { bars: AllDayBar[]; lanes: number } {
  const firstMs = startOfDay(days[0]).getTime();
  const bars: AllDayBar[] = [];
  for (const item of items) {
    if (!inAllDayBand(item)) continue;
    // Real all-day items are date-only (UTC-midnight boundaries) — anchor to local midnight before comparing,
    // same as MonthGrid. The other occupants of this band (midnight/end-of-day task and note due dates) are
    // real instants and compare as-is.
    const start = item.allDay ? allDayAnchor(item.start) : new Date(item.start);
    const rawEnd = item.end ? (item.allDay ? allDayAnchor(item.end) : new Date(item.end)) : start;
    const startMs = startOfDay(start).getTime();
    // The end is exclusive: a leave ending on Thursday 00:00 covers Monday to Wednesday.
    const lastMs = rawEnd > start ? startOfDay(new Date(rawEnd.getTime() - 1)).getTime() : startMs;
    const from = Math.round((startMs - firstMs) / 86_400_000);
    const to = Math.round((lastMs - firstMs) / 86_400_000);
    if (to < 0 || from > days.length - 1) continue;
    bars.push({ item, from: Math.max(0, from), to: Math.min(days.length - 1, to), lane: 0 });
  }
  bars.sort((a, b) => a.from - b.from || b.to - a.to);
  const laneEnds: number[] = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = bar.to;
    bar.lane = lane;
  }
  return { bars, lanes: Math.max(1, laneEnds.length) };
}

export function TimeGrid({
  days,
  today,
  items,
  onItemClick,
  onItemContextMenu,
  onItemReschedule,
  onSlotCreate,
  focusedId
}: TimeGridProps): React.ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const colWidthRef = useRef(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  // Scroll to ~1h before now (or 08:00) on mount.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = (Math.max(0, nowMin - 60) / 60) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timedByDay = useMemo(() => days.map((day) => layoutDay(day, items)), [days, items]);

  const allDay = useMemo(() => layoutAllDay(days, items), [days, items]);

  function pointerMinutes(clientY: number): number {
    const body = bodyRef.current;
    if (!body) return 0;
    const rect = body.getBoundingClientRect();
    const y = clientY - rect.top + body.scrollTop;
    return Math.min(DAY_MIN, Math.max(0, (y / HOUR_PX) * 60));
  }

  function pointerDayIndex(clientX: number): number {
    const body = bodyRef.current;
    if (!body || !colWidthRef.current) return 0;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left - GUTTER_PX;
    return Math.min(days.length - 1, Math.max(0, Math.floor(x / colWidthRef.current)));
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent): void {
      const min = pointerMinutes(e.clientY);
      const dayIndex = pointerDayIndex(e.clientX);
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.kind === "move")
          return { ...prev, grabMin: min, dayIndex, originX: e.clientX, originY: e.clientY };
        if (prev.kind === "resize")
          return {
            ...prev,
            endMin: Math.max(prev.startMin + MIN_EVENT_MIN, min),
            originX: e.clientX,
            originY: e.clientY
          };
        return { ...prev, toMin: min, dayIndex };
      });
    }
    function onUp(): void {
      setDrag((prev) => {
        if (!prev) return null;
        commit(prev);
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind]);

  function commit(state: DragState): void {
    if (state.kind === "move" && onItemReschedule) {
      if (calendarItemMode(state.item) === "none") return;
      const day = days[state.dayIndex];
      const newStartMin = snap(state.grabMin - state.durationMin / 2);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, snap(Math.max(0, newStartMin)));
      const origin = { originX: state.originX, originY: state.originY };
      if (isPointItem(state.item) || calendarItemMode(state.item) === "move") {
        onItemReschedule(state.id, { start: start.toISOString(), allDay: false, ...origin });
        return;
      }
      const end = new Date(start.getTime() + state.durationMin * 60_000);
      onItemReschedule(state.id, { start: start.toISOString(), end: end.toISOString(), allDay: false, ...origin });
    } else if (state.kind === "resize" && onItemReschedule) {
      if (calendarItemMode(state.item) !== "move-resize") return;
      const day = days[state.dayIndex];
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, state.startMin);
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, snap(state.endMin));
      onItemReschedule(state.id, {
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
        originX: state.originX,
        originY: state.originY
      });
    } else if (state.kind === "create" && onSlotCreate) {
      const day = days[state.dayIndex];
      const lo = snap(Math.min(state.fromMin, state.toMin));
      const hi = snap(Math.max(state.fromMin, state.toMin));
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, lo);
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.max(hi, lo + SNAP_MIN));
      onSlotCreate({ start: start.toISOString(), end: end.toISOString(), allDay: false });
    }
  }

  const columns = `${GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`;
  const minWidth = days.length > 1 ? GUTTER_PX + days.length * MIN_WEEK_COL_PX : undefined;

  function dropAllDay(e: React.DragEvent, day: Date): void {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id)
      onItemReschedule?.(id, {
        start: allDayDateISO(day),
        end: allDayDateISO(addDays(day, 1)),
        allDay: true,
        originX: e.clientX,
        originY: e.clientY
      });
  }

  return (
    // The week scrolls sideways inside this frame on a narrow screen: seven readable columns beat seven slivers.
    <div className="orion-scroll overflow-x-auto overflow-y-hidden rounded-xl border border-border">
      <div style={{ minWidth }}>
      {/* header */}
      <div className="grid border-b border-border bg-card/40" style={{ gridTemplateColumns: columns }}>
        <div />
        {days.map((day) => (
          <div key={dateKey(day)} className="px-2 py-1 text-center">
            <div className="text-2xs uppercase text-subtle-foreground">{WEEKDAY_LABELS[(day.getDay() + 6) % 7]}</div>
            <div
              className={clsx(
                "text-sm tabular-nums",
                sameDay(day, today) ? "font-semibold text-accent-text" : "text-muted-foreground"
              )}
            >
              {day.getDate()} {MONTH_SHORT[day.getMonth()]}
            </div>
          </div>
        ))}
      </div>

      {/* all-day row: day cells underneath take clicks and drops, bars span the days they cover */}
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${allDay.lanes}, minmax(22px, auto))` }}
      >
        <div className="px-1 py-1 text-right text-2xs leading-tight text-subtle-foreground" style={{ gridColumn: 1, gridRow: `1 / span ${allDay.lanes}` }}>
          весь
          <br />
          день
        </div>
        {days.map((day, dayIndex) => (
          <div
            key={dateKey(day)}
            onDragOver={(e) => onItemReschedule && e.preventDefault()}
            onDrop={(e) => dropAllDay(e, day)}
            onClick={() => onSlotCreate?.({ start: allDayDateISO(day), end: allDayDateISO(addDays(day, 1)), allDay: true })}
            className={clsx("border-l border-border", sameDay(day, today) && "bg-accent/[0.04]")}
            style={{ gridColumn: dayIndex + 2, gridRow: `1 / span ${allDay.lanes}` }}
          />
        ))}
        {allDay.bars.map((bar) => (
          <div
            key={bar.item.id}
            className="min-w-0 p-0.5"
            style={{ gridColumn: `${bar.from + 2} / ${bar.to + 3}`, gridRow: bar.lane + 1 }}
            onDragOver={(e) => onItemReschedule && e.preventDefault()}
            onDrop={(e) => dropAllDay(e, days[bar.from])}
          >
            <Pill
              item={bar.item}
              onClick={onItemClick}
              onContextMenu={onItemContextMenu}
              focused={bar.item.id === focusedId}
              draggable={Boolean(onItemReschedule) && calendarItemMode(bar.item) !== "none"}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", bar.item.id)}
            />
          </div>
        ))}
      </div>

      {/* scrollable hour body */}
      <div ref={bodyRef} className="relative max-h-[60vh] overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: columns, height: HOUR_PX * 24 }}
        >
          {/* hour gutter */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-2xs tabular-nums text-subtle-foreground"
                style={{ top: h * HOUR_PX }}
              >
                {h > 0 ? `${String(h).padStart(2, "0")}:00` : ""}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => (
            <DayColumn
              key={dateKey(day)}
              dayIndex={dayIndex}
              isToday={sameDay(day, today)}
              nowMin={nowMin}
              positioned={timedByDay[dayIndex]}
              drag={drag}
              colWidthRef={colWidthRef}
              onItemClick={onItemClick}
              onItemContextMenu={onItemContextMenu}
              focusedId={focusedId}
              draggableItems={Boolean(onItemReschedule)}
              startCreate={(fromMin) => onSlotCreate && setDrag({ kind: "create", dayIndex, fromMin, toMin: fromMin })}
              startMove={(item, grabMin, originX, originY) => {
                const mode = calendarItemMode(item);
                if (!onItemReschedule || mode === "none") return;
                setDrag({
                  kind: "move",
                  id: item.id,
                  item,
                  grabMin,
                  // The real length: a move keeps an overnight event overnight.
                  durationMin: durationMinutes(item),
                  dayIndex,
                  originX,
                  originY
                });
              }}
              startResize={(item, originX, originY) => {
                if (!onItemReschedule || calendarItemMode(item) !== "move-resize") return;
                setDrag({
                  kind: "resize",
                  id: item.id,
                  item,
                  startMin: minutesFromMidnight(item.start),
                  endMin: item.end ? minutesFromMidnight(item.end) || DAY_MIN : minutesFromMidnight(item.start) + MIN_EVENT_MIN,
                  dayIndex,
                  originX,
                  originY
                });
              }}
            />
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

function DayColumn({
  dayIndex,
  isToday,
  nowMin,
  positioned,
  drag,
  colWidthRef,
  onItemClick,
  onItemContextMenu,
  focusedId,
  draggableItems,
  startCreate,
  startMove,
  startResize
}: {
  dayIndex: number;
  isToday: boolean;
  nowMin: number;
  positioned: Positioned[];
  drag: DragState | null;
  colWidthRef: React.MutableRefObject<number>;
  onItemClick?: (id: string) => void;
  onItemContextMenu?: ItemContextHandler;
  focusedId?: string | null;
  draggableItems: boolean;
  startCreate: (fromMin: number) => void;
  startMove: (item: CalendarItem, grabMin: number, originX: number, originY: number) => void;
  startResize: (item: CalendarItem, originX: number, originY: number) => void;
}): React.ReactElement {
  const colRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (colRef.current) colWidthRef.current = colRef.current.offsetWidth;
  });

  function localMinutes(clientY: number): number {
    const rect = colRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(DAY_MIN, ((clientY - rect.top) / HOUR_PX) * 60));
  }

  const ghost =
    drag && drag.kind === "create" && drag.dayIndex === dayIndex
      ? { top: (Math.min(drag.fromMin, drag.toMin) / 60) * HOUR_PX, height: (Math.abs(drag.toMin - drag.fromMin) / 60) * HOUR_PX }
      : null;

  return (
    <div
      ref={colRef}
      className={clsx("relative border-l border-border", isToday && "bg-accent/[0.04]")}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return; // empty space only
        e.preventDefault();
        startCreate(snap(localMinutes(e.clientY)));
      }}
    >
      {Array.from({ length: 23 }, (_, h) => (
        <div key={h} className="absolute left-0 right-0 border-t border-border/60" style={{ top: (h + 1) * HOUR_PX }} />
      ))}

      {positioned.map((p) => {
        const mode = calendarItemMode(p.item);
        const locked = mode === "none";
        // A continuation (the 00:00–02:00 part of an overnight event) opens on click but is moved from its first day.
        const movable = draggableItems && !locked && !p.continued;
        const resizable = draggableItems && mode === "move-resize" && !p.continued && !p.continues;
        const point = isPointItem(p.item);
        const beingDragged = drag && "id" in drag && drag.id === p.item.id;
        let top = (p.startMin / 60) * HOUR_PX;
        let height = ((p.endMin - p.startMin) / 60) * HOUR_PX;
        if (beingDragged && drag.kind === "resize") height = ((drag.endMin - p.startMin) / 60) * HOUR_PX;
        if (beingDragged && drag.kind === "move") top = ((drag.grabMin - drag.durationMin / 2) / 60) * HOUR_PX;
        const width = 100 / p.lanes;
        const shown = Math.max(height, point ? 18 : 16);
        const time = point ? timeLabel(p.item.start) : `${timeLabel(p.item.start)}–${timeLabel(p.item.end ?? p.item.start)}`;
        // Room for the title above the time: a long title wraps instead of ending at the block's edge.
        const twoRows = !point && shown >= 2 * LINE_PX + 4;
        const titleLines = twoRows ? Math.max(1, Math.floor((shown - 4) / LINE_PX) - 1) : 1;
        return (
          <div
            key={p.item.id}
            role="button"
            tabIndex={0}
            title={`${p.item.label} · ${time}`}
            onClick={() => onItemClick?.(p.item.id)}
            onContextMenu={(e) => {
              if (!onItemContextMenu) return;
              e.preventDefault();
              e.stopPropagation();
              onItemContextMenu(p.item.id, contextPoint(e));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onItemClick?.(p.item.id);
            }}
            onPointerDown={(e) => {
              if (!movable || e.button !== 0) return; // a right click opens the context menu, never a drag
              e.stopPropagation();
              e.preventDefault();
              startMove(p.item, p.startMin + durationMinutes(p.item) / 2, e.clientX, e.clientY);
            }}
            style={{
              top,
              height: shown,
              left: `${p.lane * width}%`,
              width: `calc(${width}% - 3px)`,
              ...toneStyle(p.item.tone ?? "__event__")
            }}
            className={clsx(
              "absolute z-[1] overflow-hidden rounded border px-1 py-0.5 text-micro outline-none focus-visible:z-[4] focus-visible:ring-2 focus-visible:ring-accent/60",
              movable && "cursor-grab active:cursor-grabbing",
              locked && "cursor-not-allowed",
              p.item.done && "opacity-50 line-through",
              beingDragged && mode !== "none" && "opacity-80 ring-1 ring-accent",
              p.item.id === focusedId && "ring-2 ring-accent",
              p.continued && "rounded-t-none border-t-0",
              p.continues && "rounded-b-none border-b-0",
              point && "flex items-center rounded-full"
            )}
          >
            <div className={clsx("flex min-w-0 gap-1 font-medium", twoRows ? "items-start" : "items-center")}>
              {point ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" /> : null}
              {p.item.recurring ? <span aria-hidden className="shrink-0 opacity-60">↻</span> : null}
              <span
                data-event-title
                lang="ru"
                // Whole words (hyphenated where the browser can): a narrow lane must not split «Планёрка» into «План / ёрка».
                className={clsx("min-w-0", titleLines > 1 ? "hyphens-auto break-normal" : "truncate")}
                style={titleLines > 1 ? { display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
              >
                {p.item.label}
              </span>
              {!twoRows && !point ? <span className="ml-auto shrink-0 tabular-nums opacity-70">{timeLabel(p.item.start)}</span> : null}
            </div>
            {twoRows ? <div className="truncate tabular-nums opacity-70">{time}</div> : null}
            {resizable ? (
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  startResize(p.item, e.clientX, e.clientY);
                }}
                className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
              />
            ) : null}
          </div>
        );
      })}

      {ghost ? (
        <div
          className="absolute inset-x-0.5 z-[2] rounded border border-accent bg-accent/15"
          style={{ top: ghost.top, height: Math.max(ghost.height, 4) }}
        />
      ) : null}

      {isToday && nowMin >= 0 && nowMin <= DAY_MIN ? (
        <div className="pointer-events-none absolute inset-x-0 z-[3]" style={{ top: (nowMin / 60) * HOUR_PX }}>
          <div className="h-px bg-accent" />
          <LiveDot className="absolute -left-1 -top-1 text-accent-text" />
        </div>
      ) : null}
    </div>
  );
}
