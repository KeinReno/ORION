import { z } from "zod";
import type { RecurrenceSpec } from "./recurrence";

/**
 * ORION v0.10 "Календарь". An Event is a first-class calendar entity with a
 * real start/end, distinct from a task's `dueAt` or a note's `eventAt`
 * (those stay as they are and are still shown on the calendar via the
 * source registry — see apps/web/lib/calendar-sources.ts).
 *
 * Recurrence is expanded server-side for the queried window (see
 * EventsService.list + `?from&to`); the `recurrence` shape here is the
 * contract for the hand-rolled engine in ./recurrence.ts.
 */

export const recurrenceFreqSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);

/**
 * Every field is explicit (no zod `.default()`) so the schema's input and
 * output types are identical — that keeps `z.infer` structurally equal to
 * the engine's hand-written `RecurrenceSpec` and avoids a name clash with
 * the DOM `Event` global downstream. The event form always builds a full
 * spec, so requiring the fields costs nothing.
 */
export const recurrenceSpecSchema = z
  .object({
    freq: recurrenceFreqSchema,
    interval: z.number().int().min(1).max(365),
    /** weekly only: 0 = Monday .. 6 = Sunday. */
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: z.string().datetime().nullable(),
    count: z.number().int().min(1).max(1000).nullable()
  })
  .refine((s) => !(s.until && s.count), { message: "«до даты» и «N раз» взаимоисключаемы" });

// Compile-time proof the contract schema and the engine's own interface agree.
type _RecurrenceSpecMatches = z.infer<typeof recurrenceSpecSchema> extends RecurrenceSpec ? true : never;
const _recurrenceSpecMatches: _RecurrenceSpecMatches = true;
void _recurrenceSpecMatches;

/** Which occurrences a PATCH/DELETE on a recurring event touches. */
export const eventScopeSchema = z.enum(["one", "following", "all"]);
export type EventScope = z.infer<typeof eventScopeSchema>;

export const eventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  /** ISO instant. For `allDay`, midnight UTC of the start date. */
  startAt: z.string(),
  /** ISO instant, exclusive. For `allDay`, midnight UTC of the day *after* the last day. */
  endAt: z.string(),
  allDay: z.boolean(),
  /** IANA zone captured at creation — stored for future zone-aware expansion, see recurrence.ts. */
  tz: z.string().nullable(),
  /** Key into the curated calendar palette (packages/ui). */
  colorTag: z.string().nullable(),
  recurrence: recurrenceSpecSchema.nullable(),
  /**
   * Minutes before `startAt` to fire a reminder. Negative = after the start
   * (a clock time later the same day, used for all-day events).
   */
  reminders: z.array(z.number().int()),
  source: z.string(),
  readOnly: z.boolean(),
  /**
   * Which external calendar connection this event was imported from (v0.14
   * inbound ICS sources) — null for events created in ORION itself, which is
   * also what `source: "local"` means. Kept on the contract so the calendar
   * can label/filter feed events without a second request.
   */
  calendarConnectionId: z.string().nullable(),
  /**
   * Set only on a virtual occurrence returned by the windowed list: the id
   * of the master row, and the *original* (un-shifted) start of this
   * occurrence — together they address the occurrence for a `scope=one`
   * edit. Null on a plain (non-recurring) event and on the master itself.
   */
  recurringEventId: z.string().nullable(),
  occurrenceStart: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Event = z.infer<typeof eventSchema>;

/** How many clock times one event may carry. */
export const EVENT_REMINDER_LIMIT = 12;
/** Negative = after the start (up to 7 days); positive = before (up to 4 weeks). */
export const EVENT_REMINDER_MIN = -10_080;
export const EVENT_REMINDER_MAX = 40_320;

export const reminderOffsetSchema = z.number().int().min(EVENT_REMINDER_MIN).max(EVENT_REMINDER_MAX);

/** Minutes from `startAt` back to `fireAt`. Null when the gap is outside the allowed window. */
export function reminderOffsetMinutes(startAtMs: number, fireAtMs: number): number | null {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(fireAtMs)) return null;
  const minutes = Math.round((startAtMs - fireAtMs) / 60_000);
  if (minutes < EVENT_REMINDER_MIN || minutes > EVENT_REMINDER_MAX) return null;
  return minutes;
}

const eventBodyShape = {
  title: z.string().min(1, "Название обязательно").max(200),
  description: z.string().max(20_000).default(""),
  location: z.string().max(300).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().default(false),
  tz: z.string().max(64).nullable().optional(),
  colorTag: z.string().max(40).nullable().optional(),
  recurrence: recurrenceSpecSchema.nullable().optional(),
  reminders: z.array(reminderOffsetSchema).max(EVENT_REMINDER_LIMIT).default([]),
  projectId: z.string().nullable().optional()
};

export const createEventInputSchema = z
  .object(eventBodyShape)
  .refine((e) => new Date(e.endAt).getTime() > new Date(e.startAt).getTime(), {
    message: "Конец должен быть позже начала",
    path: ["endAt"]
  });
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export const updateEventInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  location: z.string().max(300).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().optional(),
  tz: z.string().max(64).nullable().optional(),
  colorTag: z.string().max(40).nullable().optional(),
  recurrence: recurrenceSpecSchema.nullable().optional(),
  reminders: z.array(reminderOffsetSchema).max(EVENT_REMINDER_LIMIT).optional(),
  projectId: z.string().nullable().optional()
});
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

/** Info the settings UI needs to show / rotate the read-only .ics subscription URL. */
export const calendarFeedInfoSchema = z.object({
  token: z.string(),
  /** Absolute `webcal://…` URL, ready to hand to a calendar app. */
  url: z.string()
});
export type CalendarFeedInfo = z.infer<typeof calendarFeedInfoSchema>;

export const calendarConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  kind: z.enum(["ics", "caldav", "google"]),
  url: z.string(),
  username: z.string(),
  color: z.string().nullable(),
  enabled: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type CalendarConnection = z.infer<typeof calendarConnectionSchema>;

export const calendarConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["ics", "caldav", "google"]).default("ics"),
  url: z.string().url("Введите адрес календаря"),
  username: z.string().max(200).default(""),
  password: z.string().max(500).default(""),
  color: z.string().max(40).nullable().optional(),
  enabled: z.boolean().default(true)
});
export type CalendarConnectionInput = z.infer<typeof calendarConnectionInputSchema>;
