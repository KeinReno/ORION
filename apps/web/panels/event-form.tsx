"use client";

import type { Event, Project, RecurrenceFreq, RecurrenceSpec } from "@orion/shared-types";
import { describeRecurrence, WEEKDAY_RU_SHORT } from "@orion/shared-types";
import { Button, Input, PALETTE_SWATCHES, Select, Textarea } from "@orion/ui";
import { Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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

const REMINDER_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 0, label: "в момент" },
  { minutes: 10, label: "за 10 мин" },
  { minutes: 30, label: "за 30 мин" },
  { minutes: 60, label: "за 1 час" },
  { minutes: 1440, label: "за 1 день" }
];

const FREQ_OPTIONS: { value: RecurrenceFreq | "none"; label: string }[] = [
  { value: "none", label: "Не повторять" },
  { value: "daily", label: "Ежедневно" },
  { value: "weekly", label: "Еженедельно" },
  { value: "monthly", label: "Ежемесячно" },
  { value: "yearly", label: "Ежегодно" }
];

function toDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fromDateInput(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
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

  const [freq, setFreq] = useState<RecurrenceFreq | "none">(initial?.recurrence?.freq ?? "none");
  const [interval, setIntervalValue] = useState(initial?.recurrence?.interval ?? 1);
  const [byWeekday, setByWeekday] = useState<number[]>(initial?.recurrence?.byWeekday ?? []);
  const [endMode, setEndMode] = useState<"never" | "until" | "count">(
    initial?.recurrence?.until ? "until" : initial?.recurrence?.count ? "count" : "never"
  );
  const [until, setUntil] = useState(initial?.recurrence?.until ? toDateInput(initial.recurrence.until) : "");
  const [count, setCount] = useState(initial?.recurrence?.count ?? 10);

  const recurrence = useMemo<RecurrenceSpec | null>(() => {
    if (freq === "none") return null;
    return {
      freq,
      interval: Math.max(1, interval),
      byWeekday: freq === "weekly" && byWeekday.length > 0 ? [...byWeekday].sort((a, b) => a - b) : undefined,
      until: endMode === "until" && until ? new Date(fromDateInput(until)).toISOString() : null,
      count: endMode === "count" ? Math.max(1, count) : null
    };
  }, [freq, interval, byWeekday, endMode, until, count]);

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

      {/* recurrence */}
      <fieldset className="rounded-lg border border-border p-2.5">
        <legend className="px-1 text-2xs text-subtle-foreground">Повтор</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq | "none")}>
            {FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {freq !== "none" ? (
            <label className="flex items-center gap-1 text-2xs text-subtle-foreground">
              каждые
              <Input
                type="number"
                min={1}
                max={365}
                value={interval}
                onChange={(e) => setIntervalValue(Number(e.target.value) || 1)}
                className="w-16"
              />
            </label>
          ) : null}
        </div>

        {freq === "weekly" ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {WEEKDAY_RU_SHORT.map((label, wd) => (
              <button
                key={wd}
                type="button"
                onClick={() =>
                  setByWeekday((prev) => (prev.includes(wd) ? prev.filter((x) => x !== wd) : [...prev, wd]))
                }
                className={
                  byWeekday.includes(wd)
                    ? "rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-2xs text-accent"
                    : "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {freq !== "none" ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select value={endMode} onChange={(e) => setEndMode(e.target.value as "never" | "until" | "count")}>
              <option value="never">бессрочно</option>
              <option value="until">до даты</option>
              <option value="count">N раз</option>
            </Select>
            {endMode === "until" ? (
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            ) : null}
            {endMode === "count" ? (
              <Input
                type="number"
                min={1}
                max={1000}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                className="w-20"
              />
            ) : null}
          </div>
        ) : null}

        {recurrence ? (
          <p className="mt-2 text-2xs text-subtle-foreground">{describeRecurrence(recurrence)}</p>
        ) : null}
      </fieldset>

      {/* reminders */}
      <fieldset className="rounded-lg border border-border p-2.5">
        <legend className="px-1 text-2xs text-subtle-foreground">Напоминания</legend>
        <div className="flex flex-wrap gap-1">
          {REMINDER_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              onClick={() =>
                setReminders((prev) =>
                  prev.includes(preset.minutes)
                    ? prev.filter((m) => m !== preset.minutes)
                    : [...prev, preset.minutes]
                )
              }
              className={
                reminders.includes(preset.minutes)
                  ? "rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-2xs text-accent"
                  : "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-2xs text-subtle-foreground">
          Придут в Telegram (или в консоль без токена) — окно приложения открывать не нужно.
        </p>
      </fieldset>

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
