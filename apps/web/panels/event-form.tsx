"use client";

import type { Event, Project, RecurrenceSpec } from "@orion/shared-types";
import { Button, Input, PALETTE_SWATCHES, Select, Textarea } from "@orion/ui";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { fromDateInput, toDateInput } from "../lib/date-input";
import { ExtensionSlot } from "../lib/extensions/slot";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/format";

/**
 * Event create/edit form — the calendar counterpart of task-form.tsx, split
 * out for the same reason (reused by the "new" Modal and the detail Sheet).
 * Recurrence and reminders are their own sections; everything the user sees
 * is Russian.
 */

export interface EventFormValues {
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  allDay: boolean;
  /** ISO instants. */
  startAt: string;
  endAt: string;
  colorTag: string | null;
  recurrence: RecurrenceSpec | null;
  reminders: number[];
  /**
   * A real project (v0.14) — same field tasks and notes carry. The list is
   * supplied by the panel, because the form has no workspace of its own.
   */
  projectId: string | null;
}


/*
 * All-day dates are date-only (Event.startAt/endAt = UTC midnights, endAt
 * exclusive — see shared-types event.ts). The form edits them as plain
 * "YYYY-MM-DD" strings with an INCLUSIVE last day, which is what a person
 * means by «Конец», and converts at the edges only:
 *  - reading a stored all-day value → its UTC date (not the local one, which
 *    is the previous day for anyone west of UTC);
 *  - writing → UTC midnight of that date (not local midnight, which is the
 *    previous UTC day for anyone east of UTC — Moscow included).
 */
const DAY_MS = 86_400_000;

function utcDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function dateInputToUtcIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function nextDateInput(value: string): string {
  return utcDateInput(new Date(new Date(dateInputToUtcIso(value)).getTime() + DAY_MS).toISOString());
}

/** Inclusive last day of a stored all-day range (endAt is exclusive). */
function lastDayInput(startIso: string, endIso: string): string {
  const last = new Date(new Date(endIso).getTime() - DAY_MS);
  return last.getTime() < new Date(startIso).getTime() ? utcDateInput(startIso) : utcDateInput(last.toISOString());
}

export function EventForm({
  initial,
  defaultStart,
  defaultEnd,
  defaultAllDay = false,
  projects,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete
}: {
  initial?: Event;
  defaultStart?: string | null;
  defaultEnd?: string | null;
  defaultAllDay?: boolean;
  /** Active projects of this workspace — the "Проект" select. Absent = projects module is off. */
  projects?: Project[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: EventFormValues) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}): React.ReactElement {
  const now = new Date();
  const startSeed = initial?.startAt ?? defaultStart ?? now.toISOString();
  const endSeed = initial?.endAt ?? defaultEnd ?? new Date(new Date(startSeed).getTime() + 3_600_000).toISOString();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [allDay, setAllDay] = useState(initial?.allDay ?? defaultAllDay);
  const [start, setStart] = useState(startSeed);
  const [end, setEnd] = useState(endSeed);
  // Seeds that are already date-only (an all-day event, or an all-day slot
  // from the «весь день» band) are read by UTC date; timed seeds by local date.
  const seedIsDateOnly = initial ? initial.allDay : defaultAllDay;
  const [startDate, setStartDate] = useState(() => (seedIsDateOnly ? utcDateInput(startSeed) : toDateInput(startSeed)));
  const [lastDate, setLastDate] = useState(() =>
    seedIsDateOnly ? lastDayInput(startSeed, endSeed) : toDateInput(startSeed)
  );
  const [colorTag, setColorTag] = useState(initial?.colorTag ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [reminders, setReminders] = useState<number[]>(initial?.reminders ?? []);

  // The rule is edited by the calendar-recurrence plugin's section; without it the stored rule is kept as is.
  const [recurrence, setRecurrence] = useState<RecurrenceSpec | null>(initial?.recurrence ?? null);

  // Switching modes carries the chosen day across instead of reinterpreting
  // the other mode's value (a UTC-midnight all-day start read as a timed
  // instant is 03:00 in Moscow, 17:00 the day before in California).
  function toggleAllDay(next: boolean): void {
    if (next) {
      const first = toDateInput(start);
      const last = toDateInput(end);
      setStartDate(first);
      setLastDate(last < first ? first : last);
    } else {
      const [y, m, d] = startDate.split("-").map(Number);
      const nine = new Date(y, m - 1, d, 9, 0, 0);
      setStart(nine.toISOString());
      setEnd(new Date(nine.getTime() + 3_600_000).toISOString());
    }
    setAllDay(next);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    let startISO = start;
    let endISO = end;
    if (allDay) {
      startISO = dateInputToUtcIso(startDate);
      endISO = dateInputToUtcIso(nextDateInput(lastDate < startDate ? startDate : lastDate));
    } else if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
      endISO = new Date(new Date(startISO).getTime() + 3_600_000).toISOString();
    }
    void onSubmit({
      title: title.trim(),
      description,
      location: location.trim() || null,
      url: url.trim() || null,
      allDay,
      startAt: startISO,
      endAt: endISO,
      colorTag: colorTag.trim() || null,
      recurrence,
      reminders: [...reminders].sort((a, b) => a - b),
      projectId: projectId || null
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
      <Textarea
        placeholder="Описание (необязательно)"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="flex items-center gap-2 text-2xs text-subtle-foreground">
        <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
        Весь день
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Начало
          {allDay ? (
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                if (!e.target.value) return;
                setStartDate(e.target.value);
                if (lastDate < e.target.value) setLastDate(e.target.value);
              }}
            />
          ) : (
            <Input
              type="datetime-local"
              value={toDatetimeLocal(start)}
              onChange={(e) => setStart(fromDatetimeLocal(e.target.value) ?? start)}
            />
          )}
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Конец
          {allDay ? (
            <Input
              type="date"
              value={lastDate}
              min={startDate}
              onChange={(e) => e.target.value && setLastDate(e.target.value)}
            />
          ) : (
            <Input
              type="datetime-local"
              value={toDatetimeLocal(end)}
              onChange={(e) => setEnd(fromDatetimeLocal(e.target.value) ?? end)}
            />
          )}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Место
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="—" />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Ссылка
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
      </div>

      {projects ? (
      <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Проект
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Без проекта</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </label>
      ) : null}

      <div className="flex flex-col gap-1 text-2xs text-subtle-foreground">
        Цвет
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setColorTag("")}
            aria-label="без цвета"
            className={
              colorTag === ""
                ? "h-5 w-5 rounded-full border-2 border-accent text-2xs text-muted-foreground"
                : "h-5 w-5 rounded-full border border-border text-2xs text-muted-foreground"
            }
          >
            ×
          </button>
          {PALETTE_SWATCHES.map((sw) => (
            <button
              key={sw.key}
              type="button"
              aria-label={`цвет ${sw.key}`}
              onClick={() => setColorTag(sw.key)}
              style={{ backgroundColor: sw.color }}
              className={
                colorTag === sw.key
                  ? "h-5 w-5 rounded-full ring-2 ring-accent ring-offset-1 ring-offset-card"
                  : "h-5 w-5 rounded-full"
              }
            />
          ))}
        </div>
      </div>

      <ExtensionSlot name="calendar.event.recurrence" props={{ value: recurrence, onChange: setRecurrence }} />
      <ExtensionSlot name="calendar.event.reminders" props={{ value: reminders, onChange: setReminders }} />

      <div className="mt-1 flex items-center justify-between gap-2">
        {onDelete ? (
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> Удалить
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={busy || !title.trim()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
