"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

export interface CalendarItem {
  id: string;
  /** ISO datetime — only the calendar date part is used for placement. */
  date: string;
  label: string;
  overdue?: boolean;
}

export interface CalendarProps {
  items: CalendarItem[];
  onItemClick?: (id: string) => void;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_LABELS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday-first month grid — no external calendar library, kept intentionally simple for v0. */
export function Calendar({ items, onItemClick }: CalendarProps): React.ReactElement {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const key = dateKey(new Date(item.date));
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    // getDay(): 0=Sun..6=Sat -> convert to Monday-first offset
    const leading = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - leading);
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date, inMonth: date.getMonth() === month };
    });
  }, [cursor]);

  const today = dateKey(new Date());

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="rounded-md border border-white/10 px-2 py-1 text-sm text-white/60 hover:bg-white/5 hover:text-white"
        >
          ←
        </button>
        <span className="text-sm font-medium">
          {MONTH_LABELS[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="rounded-md border border-white/10 px-2 py-1 text-sm text-white/60 hover:bg-white/5 hover:text-white"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-white/40">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ date, inMonth }) => {
          const key = dateKey(date);
          const dayItems = itemsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={clsx(
                "min-h-[72px] rounded-lg border p-1 text-left align-top",
                key === today ? "border-white/30 bg-white/[0.06]" : "border-white/5",
                !inMonth && "opacity-30"
              )}
            >
              <div className="mb-1 text-[11px] text-white/50">{date.getDate()}</div>
              <div className="flex flex-col gap-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item.id)}
                    title={item.label}
                    className={clsx(
                      "truncate rounded px-1 py-0.5 text-left text-[10px]",
                      item.overdue ? "bg-red-500/20 text-red-200" : "bg-white/10 text-white/80"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
                {dayItems.length > 3 ? (
                  <span className="px-1 text-[10px] text-white/40">+{dayItems.length - 3} ещё</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
