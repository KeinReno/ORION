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
  const [colorTag, setColorTag] = useState(initial?.colorTag ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [reminders, setReminders] = useState<number[]>(initial?.reminders ?? []);

  // The rule is edited by the calendar-recurrence plugin's section; without it the stored rule is kept as is.
  const [recurrence, setRecurrence] = useState<RecurrenceSpec | null>(initial?.recurrence ?? null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    const startISO = allDay ? fromDateInput(toDateInput(start)) : start;
    let endISO = allDay ? fromDateInput(toDateInput(end)) : end;
    if (new Date(endISO).getTime() <= new Date(startISO).getTime()) {
      endISO = new Date(new Date(startISO).getTime() + (allDay ? 86_400_000 : 3_600_000)).toISOString();
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
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
        Весь день
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
          Начало
          {allDay ? (
            <Input type="date" value={toDateInput(start)} onChange={(e) => setStart(fromDateInput(e.target.value))} />
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
            <Input type="date" value={toDateInput(end)} onChange={(e) => setEnd(fromDateInput(e.target.value))} />
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
