"use client";

import clsx from "clsx";
import { useMemo, type ReactNode } from "react";
import { timeLabel, type CalendarItem } from "./shared";

/** Forward-looking flat list, grouped by day, with a leading "Просрочено" bucket. */
export function Agenda({
  items,
  onItemClick,
  focusedId,
  renderItemActions
}: {
  items: CalendarItem[];
  onItemClick?: (id: string) => void;
  focusedId?: string | null;
  renderItemActions?: (item: CalendarItem) => ReactNode;
}): React.ReactElement {
  const groups = useMemo(() => {
    const now = Date.now();
    const relevant = items
      .filter((it) => it.overdue || new Date(it.start).getTime() >= now - 86_400_000)
      .sort((a, b) => a.start.localeCompare(b.start));
    const map = new Map<string, CalendarItem[]>();
    for (const it of relevant) {
      const label = it.overdue
        ? "Просрочено"
        : new Date(it.start).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
      const bucket = map.get(label) ?? [];
      bucket.push(it);
      map.set(label, bucket);
    }
    return [...map.entries()];
  }, [items]);

  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Ничего не запланировано.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([label, group]) => (
        <div key={label}>
          <p
            className={clsx(
              "mb-1.5 text-2xs font-medium uppercase tracking-wide",
              label === "Просрочено" ? "text-destructive" : "text-subtle-foreground"
            )}
          >
            {label}
          </p>
          <div className="flex flex-col gap-1">
            {group.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onItemClick?.(item.id)}
                className={clsx(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-white/[0.02] px-2.5 py-2 text-left text-xs hover:border-border-strong hover:bg-card-hover",
                  item.id === focusedId ? "border-accent/40 ring-2 ring-accent" : "border-border"
                )}
              >
                <span className="w-14 shrink-0 tabular-nums text-2xs text-subtle-foreground">
                  {item.allDay ? "весь день" : timeLabel(item.start)}
                </span>
                {item.recurring ? <span className="text-2xs opacity-60">↻</span> : null}
                <span className={clsx("truncate", item.done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {item.label}
                </span>
              </button>
              {renderItemActions?.(item)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
