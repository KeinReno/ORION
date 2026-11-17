"use client";

import type { CalendarItem } from "@orion/ui";
import type { ContactCard, Event, Note, OrionModuleId, PlanningBlock, RecurringTransaction, Task } from "@orion/shared-types";
import { isTaskClosed, nextBirthday } from "@orion/shared-types";
import { formatMoney } from "./format";

/**
 * The calendar is a lens over several modules, not just one table. Each
 * source maps its own rows onto `CalendarItem`s; the panel toggles them via
 * a legend. Adding a future source (habits, deadlines…) means one entry
 * here — the `<Calendar />` component never changes. Mirrors the spirit of
 * `panel-registry.ts`.
 */

export type CalendarSourceId = "events" | "tasks" | "notes" | "finance" | "contacts" | "planning";

export interface CalendarSourceMeta {
  id: CalendarSourceId;
  label: string;
  /** Tone key → colour from the curated palette in @orion/ui. */
  toneKey: string;
}

export const CALENDAR_SOURCES: CalendarSourceMeta[] = [
  { id: "events", label: "События", toneKey: "__event__" },
  { id: "tasks", label: "Задачи", toneKey: "__task__" },
  { id: "notes", label: "Заметки", toneKey: "__note__" },
  { id: "finance", label: "Платежи", toneKey: "__finance__" },
  { id: "contacts", label: "Дни рождения", toneKey: "__birthday__" },
  { id: "planning", label: "План", toneKey: "__planning__" }
];

/** Neighbour overlay. `null` = this panel's own events, always on while Calendar is open. */
export const CALENDAR_SOURCE_MODULE: Record<CalendarSourceId, OrionModuleId | null> = {
  events: null,
  tasks: "tasks",
  notes: "notes",
  finance: "finance",
  contacts: "contacts",
  planning: "planning"
};

export function eventItems(events: Event[] | undefined): CalendarItem[] {
  return (events ?? []).map((ev) => ({
    id: ev.id,
    start: ev.startAt,
    end: ev.endAt,
    allDay: ev.allDay,
    label: ev.title || "Без названия",
    tone: ev.colorTag ?? "__event__",
    kind: "event",
    recurring: Boolean(ev.recurrence || ev.recurringEventId),
    // Events imported from an external feed (v0.14) are read-only here: the
    // calendar must not offer drag-move for something it can't write back.
    readOnly: ev.readOnly
  }));
}

export function taskItems(tasks: Task[] | undefined): CalendarItem[] {
  return (tasks ?? [])
    .filter((task) => task.dueAt)
    .map((task) => ({
      id: task.id,
      start: task.dueAt as string,
      label: task.title,
      done: task.status === "done",
      overdue: !isTaskClosed(task.status) && new Date(task.dueAt as string).getTime() < Date.now(),
      tone: "__task__",
      kind: "task"
    }));
}

export function noteItems(notes: Note[] | undefined): CalendarItem[] {
  return (notes ?? [])
    .filter((note) => note.eventAt && !note.deletedAt)
    .map((note) => ({
      id: note.id,
      start: note.eventAt as string,
      label: note.title || "Без заголовка",
      tone: "__note__",
      kind: "note",
      readOnly: true
    }));
}

/** The single next materialisation of each active recurring payment — read-only on the calendar. */
export function financeItems(recurring: RecurringTransaction[] | undefined): CalendarItem[] {
  return (recurring ?? [])
    .filter((rule) => !rule.pausedAt)
    .map((rule) => ({
      id: `recurring-${rule.id}`,
      start: rule.nextRunAt,
      allDay: true,
      label: `${rule.type === "expense" ? "−" : "+"}${formatMoney(rule.amount)}${rule.note ? ` · ${rule.note}` : ""}`,
      tone: "__finance__",
      kind: "finance",
      readOnly: true
    }));
}

/**
 * Planning time blocks (`planning.blocks`) — окна фокуса/встреч из модуля планирования.
 * Read-only на календаре: перенос блока делается в планировании, где считаются конфликты.
 */
export const BLOCK_ITEM_PREFIX = "block-";

export function blockItems(blocks: PlanningBlock[] | undefined): CalendarItem[] {
  return (blocks ?? []).map((block) => ({
    id: `block-${block.id}`,
    start: block.startAt,
    end: block.endAt,
    label: block.title,
    tone: "__planning__",
    kind: "planning",
    readOnly: true
  }));
}

/** Prefix of a birthday pill id: `birthday-<contactId>-<year>`. */
export const BIRTHDAY_ITEM_PREFIX = "birthday-";

export function contactIdFromBirthdayItem(itemId: string): string | null {
  return itemId.startsWith(BIRTHDAY_ITEM_PREFIX) ? itemId.slice(BIRTHDAY_ITEM_PREFIX.length, -5) : null;
}

/** Every birthday that falls into the years the visible range touches, as all-day read-only pills. */
export function birthdayItems(contacts: ContactCard[] | undefined, range: { from: string; to: string } | undefined): CalendarItem[] {
  if (!range) return [];
  const firstYear = new Date(range.from).getFullYear();
  const lastYear = new Date(range.to).getFullYear();
  const items: CalendarItem[] = [];
  for (const contact of contacts ?? []) {
    if (!contact.birthday || contact.archivedAt) continue;
    for (let year = firstYear; year <= lastYear; year += 1) {
      // Reuse the leap-day rule: ask for the occurrence on 1 January of that year.
      const occurrence = nextBirthday(contact.birthday, `${year}-01-01`);
      if (!occurrence) continue;
      const [y, m, d] = occurrence.date.split("-").map(Number) as [number, number, number];
      items.push({
        id: `${BIRTHDAY_ITEM_PREFIX}${contact.id}-${y}`,
        // All-day pills carry the UTC-midnight of their date; the calendar re-anchors it to the local day (see allDayAnchor).
        start: new Date(Date.UTC(y, m - 1, d)).toISOString(),
        allDay: true,
        label: `🎂 ${contact.name}${occurrence.turning !== null ? ` · ${occurrence.turning}` : ""}`,
        tone: "__birthday__",
        kind: "birthday",
        readOnly: true
      });
    }
  }
  return items;
}
