"use client";

import clsx from "clsx";
import type { CSSProperties } from "react";

/**
 * One thing placed on the calendar. A native Event carries `start`+`end`;
 * a task's due date or a note's date has only `start` (rendered as a short
 * marker). `kind` routes a click back to the right panel; `readOnly` marks
 * pills that can't be dragged (a materialised finance payment).
 */
export interface CalendarItem {
  id: string;
  /** ISO instant. */
  start: string;
  /** ISO instant, exclusive. Absent ⇒ a point in time (task/note). */
  end?: string;
  allDay?: boolean;
  label: string;
  overdue?: boolean;
  done?: boolean;
  /** Free key mapped to a stable colour from the curated palette. */
  tone?: string | null;
  kind?: "task" | "note" | "event" | "finance" | "birthday";
  /** True ⇒ part of a recurring series (shows a ↻ marker). */
  recurring?: boolean;
  /** True ⇒ not draggable/resizable (e.g. a generated finance payment). */
  readOnly?: boolean;
}

/** What a pointer/HTML5 drag is allowed to do to this pill. */
export type CalendarItemMode = "move-resize" | "move" | "none";

export function calendarItemMode(item: CalendarItem): CalendarItemMode {
  if (item.readOnly || item.kind === "note" || item.kind === "finance" || item.kind === "birthday") return "none";
  if (item.kind === "task") return "move";
  return "move-resize";
}

/** Timed marker without a duration (task due, note date) — a dot, not a bar. */
export function isPointItem(item: CalendarItem): boolean {
  return item.end === undefined && !item.allDay;
}

/**
 * All-day row vs hour grid: real `allDay` items, plus date-only points
 * (midnight / end-of-day due dates) so they don't sit on a 23:59 bar.
 */
export function inAllDayBand(item: CalendarItem): boolean {
  if (item.allDay) return true;
  if (item.end !== undefined) return false;
  const minutes = new Date(item.start).getHours() * 60 + new Date(item.start).getMinutes();
  return minutes === 0 || minutes >= 23 * 60;
}

export type CalendarView = "month" | "week" | "day" | "agenda";

export interface ReschedulePayload {
  start: string;
  end?: string;
  allDay?: boolean;
  /** Pointer position at drop — used to park a recurring-scope popover. */
  originX?: number;
  originY?: number;
}

export interface SlotCreatePayload {
  start: string;
  end?: string;
  allDay: boolean;
}

/* ----------------------------------------------------------------- labels */

export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const MONTH_LABELS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];
export const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/* ------------------------------------------------------------- date utils */

/** Local `YYYY-MM-DD` key for bucketing by day. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-first start of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * `Event.startAt`/`endAt` for an `allDay` event are UTC-midnight day
 * boundaries (see `normaliseRange` in `apps/api/src/events/events.service.ts`)
 * — a date-only contract, not a real instant, same principle as habits'
 * local-day key. Bucketing calendar items by calendar day (month/time grid)
 * reads LOCAL `Date` getters (`startOfDay`, `dateKey`); calling those
 * directly on the raw ISO instant reinterprets the UTC calendar date in the
 * viewer's zone, which silently shifts an all-day pill a day earlier for
 * every viewer west of UTC. Anchor the UTC date onto local midnight first so
 * day-bucketing always lands on the date the event actually means.
 */
export function allDayAnchor(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Local ISO string for a wall-clock time on `day` (hours may be fractional). */
export function dayTimeToISO(day: Date, hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), whole, minutes, 0, 0).toISOString();
}

/** Local noon of `day` — a sane default for an all-day / date-only placement. */
export function dayToISO(day: Date): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0).toISOString();
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/* ---------------------------------------------------------------- palette */

/**
 * Curated pill palette — 10 hues hand-picked to clear WCAG AA on the dark
 * card background (the old code hashed a raw `hue` and often produced
 * unreadable low-contrast pills). Each entry is text / fill / border.
 */
const PALETTE: { fg: string; bg: string; border: string }[] = [
  { fg: "hsl(213 96% 82%)", bg: "hsl(213 90% 60% / 0.16)", border: "hsl(213 90% 62% / 0.42)" },
  { fg: "hsl(160 70% 76%)", bg: "hsl(160 70% 45% / 0.16)", border: "hsl(160 70% 50% / 0.42)" },
  { fg: "hsl(280 85% 84%)", bg: "hsl(280 80% 65% / 0.16)", border: "hsl(280 80% 68% / 0.42)" },
  { fg: "hsl(28 96% 76%)", bg: "hsl(28 92% 55% / 0.16)", border: "hsl(28 92% 58% / 0.42)" },
  { fg: "hsl(342 92% 82%)", bg: "hsl(342 85% 62% / 0.16)", border: "hsl(342 85% 65% / 0.42)" },
  { fg: "hsl(190 85% 78%)", bg: "hsl(190 82% 50% / 0.16)", border: "hsl(190 82% 55% / 0.42)" },
  { fg: "hsl(52 90% 74%)", bg: "hsl(52 85% 52% / 0.16)", border: "hsl(52 85% 55% / 0.4)" },
  { fg: "hsl(255 90% 84%)", bg: "hsl(255 85% 68% / 0.16)", border: "hsl(255 85% 70% / 0.42)" },
  { fg: "hsl(130 65% 76%)", bg: "hsl(130 60% 45% / 0.16)", border: "hsl(130 60% 50% / 0.42)" },
  { fg: "hsl(8 92% 78%)", bg: "hsl(8 88% 60% / 0.16)", border: "hsl(8 88% 63% / 0.42)" }
];

/**
 * Reserved tone keys: the source registry's non-event pills, plus `c0`..`c9`
 * which name a palette slot directly (what the event form's swatch picker
 * stores). Anything else is hashed to a stable slot.
 */
const FIXED_TONES: Record<string, number> = { __note__: 5, __finance__: 3, __event__: 0, __task__: 1, __birthday__: 8 };

function toneIndex(tone: string): number {
  const fixed = FIXED_TONES[tone];
  if (fixed !== undefined) return fixed;
  const explicit = /^c([0-9])$/.exec(tone);
  if (explicit) return Number(explicit[1]);
  let hash = 0;
  for (let i = 0; i < tone.length; i++) hash = (hash * 31 + tone.charCodeAt(i)) | 0;
  return Math.abs(hash) % PALETTE.length;
}

export function toneStyle(tone?: string | null): CSSProperties | undefined {
  if (!tone) return undefined;
  const p = PALETTE[toneIndex(tone)];
  return { color: p.fg, backgroundColor: p.bg, borderColor: p.border };
}

/** `c0`..`c9` swatch keys + their fill, for a colour picker. */
export const PALETTE_SWATCHES = PALETTE.map((p, i) => ({ key: `c${i}`, color: p.border }));

/* ------------------------------------------------------------------- Pill */

export function Pill({
  item,
  onClick,
  draggable = false,
  onDragStart,
  showTime = false,
  focused = false,
  className
}: {
  item: CalendarItem;
  onClick?: (id: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  showTime?: boolean;
  focused?: boolean;
  className?: string;
}): React.ReactElement {
  const style = item.overdue ? undefined : toneStyle(item.tone ?? "__event__");
  const locked = calendarItemMode(item) === "none";
  const point = isPointItem(item);
  return (
    <button
      type="button"
      draggable={draggable && !locked}
      onDragStart={(e) => {
        if (locked || !draggable) {
          e.preventDefault();
          return;
        }
        onDragStart?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(item.id);
      }}
      title={item.label}
      style={style}
      className={clsx(
        "flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-micro transition-opacity",
        draggable && !locked && "cursor-grab active:cursor-grabbing",
        locked && "cursor-not-allowed",
        item.overdue
          ? "border-destructive/40 bg-destructive/15 text-destructive"
          : !item.tone && "border-transparent bg-white/10 text-foreground/80",
        item.done && "opacity-50 line-through",
        point && "rounded-full",
        focused && "ring-2 ring-accent",
        className
      )}
    >
      {point ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" /> : null}
      {showTime && !item.allDay ? (
        <span className="shrink-0 tabular-nums opacity-70">{timeLabel(item.start)}</span>
      ) : null}
      {item.recurring ? <span className="shrink-0 opacity-60">↻</span> : null}
      <span className="truncate">{item.label}</span>
    </button>
  );
}
