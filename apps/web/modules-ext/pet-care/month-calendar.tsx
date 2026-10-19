"use client";

import { PET_DAY_STATUS_META, type PetDayStatus } from "@orion/shared-types";
import { IconButton, cx } from "@orion/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PET_WEEKDAYS, formatPetDay, petMonthGrid, petMonthLabel, shiftPetMonth } from "../../lib/pet-care-days";

export interface PetMonthCursor {
  year: number;
  month: number;
}

export interface PetCalendarMark {
  status: PetDayStatus;
  hasNote: boolean;
  symptomCount: number;
}

/** Календарь месяца: день окрашен по состоянию питомца, точка внизу — есть событие. */
export function PetMonthCalendar({
  cursor,
  onCursor,
  selected,
  today,
  marks,
  eventDays,
  onPick
}: {
  cursor: PetMonthCursor;
  onCursor: (cursor: PetMonthCursor) => void;
  selected: string;
  today: string;
  marks: ReadonlyMap<string, PetCalendarMark>;
  eventDays: ReadonlySet<string>;
  onPick: (day: string) => void;
}): React.ReactElement {
  const cells = petMonthGrid(cursor.year, cursor.month);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <IconButton label="Предыдущий месяц" onClick={() => onCursor(shiftPetMonth(cursor, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="text-sm font-medium capitalize">{petMonthLabel(cursor)}</span>
        <IconButton label="Следующий месяц" onClick={() => onCursor(shiftPetMonth(cursor, 1))}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-2xs uppercase tracking-wide text-muted-foreground">
        {PET_WEEKDAYS.map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const mark = marks.get(cell.day);
          const color = mark ? PET_DAY_STATUS_META[mark.status].color : undefined;
          const future = cell.day > today;
          return (
            <button
              key={cell.day}
              type="button"
              onClick={() => onPick(cell.day)}
              aria-pressed={cell.day === selected}
              aria-label={`${formatPetDay(cell.day)}${mark ? `: ${PET_DAY_STATUS_META[mark.status].label}` : ""}`}
              className={cx(
                "relative flex aspect-square flex-col items-center justify-center rounded-md border text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
                cell.inMonth ? "text-foreground" : "text-muted-foreground/50",
                cell.day === selected ? "border-accent" : "border-transparent hover:bg-white/5",
                future && "opacity-60"
              )}
              style={color ? { backgroundColor: `${color}33` } : undefined}
            >
              <span className={cx("tabular-nums", cell.day === today && "font-bold underline underline-offset-2")}>{cell.dayOfMonth}</span>
              <span className="absolute bottom-1 flex gap-0.5" aria-hidden>
                {color ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> : null}
                {eventDays.has(cell.day) ? <span className="h-1.5 w-1.5 rotate-45 bg-muted-foreground" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        {(Object.keys(PET_DAY_STATUS_META) as PetDayStatus[]).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: PET_DAY_STATUS_META[status].color }} />
            {PET_DAY_STATUS_META[status].short}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rotate-45 bg-muted-foreground" /> событие
        </span>
      </div>
    </div>
  );
}
