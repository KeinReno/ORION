"use client";

import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LiveDot } from "../live-dot";
import {
  addDays,
  allDayAnchor,
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
  type CalendarItem,
  type ReschedulePayload,
  type SlotCreatePayload
} from "./shared";

const HOUR_PX = 36;
const GUTTER_PX = 40;
const SNAP_MIN = 15;
const MIN_EVENT_MIN = 15;
const DAY_MIN = 24 * 60;

interface TimeGridProps {
  /** 1 (day view) or 7 (week view) consecutive days, Monday-first. */
  days: Date[];
  today: Date;
  items: CalendarItem[];
  onItemClick?: (id: string) => void;
  onItemReschedule?: (id: string, payload: ReschedulePayload) => void;
  onSlotCreate?: (payload: SlotCreatePayload) => void;
  focusedId?: string | null;
}

interface Positioned {
  item: CalendarItem;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
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

/** Greedy lane packing for the timed items of one day. */
function layoutDay(dayItems: CalendarItem[]): Positioned[] {
  const sorted = [...dayItems].sort((a, b) => a.start.localeCompare(b.start));
  const active: Positioned[] = [];
  const out: Positioned[] = [];
  for (const item of sorted) {
    const startMin = minutesFromMidnight(item.start);
    const endMin = item.end
      ? Math.max(startMin + MIN_EVENT_MIN, minutesFromMidnight(item.end) || DAY_MIN)
      : startMin + MIN_EVENT_MIN;
    for (let i = active.length - 1; i >= 0; i--) if (active[i].endMin <= startMin) active.splice(i, 1);
    const usedLanes = new Set(active.map((p) => p.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane++;
    const positioned: Positioned = { item, startMin, endMin, lane, lanes: lane + 1 };
    active.push(positioned);
    out.push(positioned);
    const lanes = Math.max(...active.map((p) => p.lane)) + 1;
    for (const p of active) p.lanes = Math.max(p.lanes, lanes);
  }
  return out;
}

export function TimeGrid({
  days,
  today,
  items,
  onItemClick,
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

  const timedByDay = useMemo(() => {
    return days.map((day) =>
      layoutDay(items.filter((it) => !inAllDayBand(it) && sameDay(new Date(it.start), day)))
    );
  }, [days, items]);

  const allDayByDay = useMemo(
    () =>
      days.map((day) =>
        items.filter((it) => {
          if (!inAllDayBand(it)) return false;
          // Real all-day items are date-only (UTC-midnight boundaries) —
          // anchor to local midnight before comparing, same as MonthGrid.
          // The other occupants of this band (midnight/end-of-day task and
          // note due dates) are real instants and compare as-is.
          const start = it.allDay ? allDayAnchor(it.start) : new Date(it.start);
          const end = it.end ? (it.allDay ? allDayAnchor(it.end) : new Date(it.end)) : start;
          return start < addDays(startOfDay(day), 1) && end >= startOfDay(day);
        })
      ),
    [days, items]
  );

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

  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      {/* header */}
      <div className="grid border-b border-white/5 bg-white/[0.02]" style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, 1fr)` }}>
        <div />
        {days.map((day) => (
          <div key={dateKey(day)} className="px-2 py-1 text-center">
            <div className="text-2xs uppercase text-subtle-foreground">{WEEKDAY_LABELS[(day.getDay() + 6) % 7]}</div>
            <div
              className={clsx(
                "text-sm tabular-nums",
                sameDay(day, today) ? "font-semibold text-accent" : "text-muted-foreground"
              )}
            >
              {day.getDate()} {MONTH_SHORT[day.getMonth()]}
            </div>
          </div>
        ))}
      </div>

      {/* all-day row */}
      <div
        className="grid border-b border-white/5"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, 1fr)` }}
      >
        <div className="px-1 py-1 text-right text-2xs text-subtle-foreground">весь&nbsp;день</div>
        {days.map((day, dayIndex) => (
          <div
            key={dateKey(day)}
            onDragOver={(e) => onItemReschedule && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id)
                onItemReschedule?.(id, {
                  start: startOfDay(day).toISOString(),
                  end: addDays(startOfDay(day), 1).toISOString(),
                  allDay: true,
                  originX: e.clientX,
                  originY: e.clientY
                });
            }}
            onClick={() => onSlotCreate?.({ start: startOfDay(day).toISOString(), end: addDays(startOfDay(day), 1).toISOString(), allDay: true })}
            className="min-h-[22px] space-y-0.5 border-l border-white/5 p-0.5"
          >
            {allDayByDay[dayIndex].map((item) => (
              <Pill
                key={item.id}
                item={item}
                onClick={onItemClick}
                focused={item.id === focusedId}
                draggable={Boolean(onItemReschedule) && calendarItemMode(item) !== "none"}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", item.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* scrollable hour body */}
      <div ref={bodyRef} className="relative max-h-[60vh] overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${days.length}, 1fr)`, height: HOUR_PX * 24 }}
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
                  durationMin: Math.max(
                    MIN_EVENT_MIN,
                    (item.end ? minutesFromMidnight(item.end) || DAY_MIN : minutesFromMidnight(item.start) + MIN_EVENT_MIN) -
                      minutesFromMidnight(item.start)
                  ),
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
      className={clsx("relative border-l border-white/5", isToday && "bg-accent/[0.04]")}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return; // empty space only
        e.preventDefault();
        startCreate(snap(localMinutes(e.clientY)));
      }}
    >
      {Array.from({ length: 23 }, (_, h) => (
        <div key={h} className="absolute left-0 right-0 border-t border-white/5" style={{ top: (h + 1) * HOUR_PX }} />
      ))}

      {positioned.map((p) => {
        const mode = calendarItemMode(p.item);
        const locked = mode === "none";
        const point = isPointItem(p.item);
        const beingDragged = drag && "id" in drag && drag.id === p.item.id;
        let top = (p.startMin / 60) * HOUR_PX;
        let height = ((p.endMin - p.startMin) / 60) * HOUR_PX;
        if (beingDragged && drag.kind === "resize") height = ((drag.endMin - p.startMin) / 60) * HOUR_PX;
        if (beingDragged && drag.kind === "move") top = ((drag.grabMin - (p.endMin - p.startMin) / 2) / 60) * HOUR_PX;
        const width = 100 / p.lanes;
        return (
          <div
            key={p.item.id}
            role="button"
            tabIndex={0}
            onClick={() => onItemClick?.(p.item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onItemClick?.(p.item.id);
            }}
            onPointerDown={(e) => {
              if (!draggableItems || locked) return;
              e.stopPropagation();
              e.preventDefault();
              startMove(p.item, (p.startMin + p.endMin) / 2, e.clientX, e.clientY);
            }}
            style={{
              top,
              height: Math.max(height, point ? 18 : 16),
              left: `${p.lane * width}%`,
              width: `calc(${width}% - 3px)`,
              ...toneStyle(p.item.tone ?? "__event__")
            }}
            className={clsx(
              "absolute z-[1] overflow-hidden rounded border px-1 py-0.5 text-micro",
              draggableItems && mode !== "none" && "cursor-grab active:cursor-grabbing",
              locked && "cursor-not-allowed",
              p.item.done && "opacity-50 line-through",
              beingDragged && mode !== "none" && "opacity-80 ring-1 ring-accent",
              p.item.id === focusedId && "ring-2 ring-accent",
              point && "flex items-center rounded-full"
            )}
          >
            <div className="flex min-w-0 items-center gap-1 truncate font-medium">
              {point ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" /> : null}
              {p.item.recurring ? <span className="opacity-60">↻</span> : null}
              <span className="truncate">{p.item.label}</span>
            </div>
            {point ? null : (
              <div className="tabular-nums opacity-70">
                {new Date(p.item.start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
            {draggableItems && mode === "move-resize" ? (
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
          <LiveDot className="absolute -left-1 -top-1 text-accent" />
        </div>
      ) : null}
    </div>
  );
}
