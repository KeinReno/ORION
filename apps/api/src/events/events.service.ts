import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  recurrenceSpecSchema,
  expandRecurrence,
  recurrenceToRRule,
  type CalendarFeedInfo,
  type CreateEventInput,
  type Event,
  type EventScope,
  type RecurrenceSpec,
  type UpdateEventInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { buildICal, type ICalEntry } from "./ical";

type EventModel = Prisma.EventGetPayload<Record<string, never>>;
type OverrideModel = Prisma.EventOverrideGetPayload<Record<string, never>>;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Windowed list — the ONE place in ORION where filtering moved to the
   * server (see docs/PLAN.md v0.10): a recurring event's occurrences can't
   * be materialised client-side without shipping every rule and every
   * expansion. Returns real (non-recurring) events overlapping
   * `[from, to)` plus one virtual event per in-window occurrence of each
   * recurring master, with per-occurrence overrides already applied.
   */
  async list(userId: string, workspaceId: string, fromISO: string, toISO: string): Promise<Event[]> {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException("Некорректное окно запроса (from/to)");
    }

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.event.findMany({
        where: { workspaceId, startAt: { lt: to } },
        include: { overrides: true }
      });

      const out: Event[] = [];
      for (const ev of rows) {
        if (!ev.recurrence) {
          if (ev.endAt > from) out.push(toDto(ev));
          continue;
        }
        const spec = recurrenceSpecSchema.parse(ev.recurrence);
        const durationMs = ev.endAt.getTime() - ev.startAt.getTime();
        // Pad the left edge by the duration so an occurrence that starts
        // before `from` but still overlaps it is not missed.
        const starts = expandRecurrence(spec, ev.startAt, new Date(from.getTime() - durationMs), to);
        const overrideByStart = new Map(ev.overrides.map((o) => [o.occurrenceStart.getTime(), o]));

        for (const occStart of starts) {
          const ovr = overrideByStart.get(occStart.getTime());
          if (ovr?.canceled) continue;
          const start = ovr?.startAt ?? occStart;
          const end = ovr?.endAt ?? new Date(occStart.getTime() + durationMs);
          if (end <= from) continue;
          out.push(occurrenceDto(ev, occStart, start, end, ovr ?? null));
        }
      }
      return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
    });
  }

  async create(userId: string, workspaceId: string, input: CreateEventInput): Promise<Event> {
    const { startAt, endAt } = normaliseRange(input.startAt, input.endAt, input.allDay);
    const event = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await assertProjectTx(tx, workspaceId, input.projectId ?? null);
      return tx.event.create({
        data: {
          workspaceId,
          title: input.title,
          description: input.description,
          location: input.location ?? null,
          url: input.url ?? null,
          startAt,
          endAt,
          allDay: input.allDay,
          tz: input.tz ?? null,
          colorTag: input.colorTag ?? null,
          recurrence: input.recurrence ? (recurrenceSpecSchema.parse(input.recurrence) as Prisma.InputJsonValue) : Prisma.DbNull,
          reminders: input.reminders,
          projectId: input.projectId ?? null
        }
      });
    });
    return toDto(event);
  }

  /**
   * `scope` (recurring events only):
   *  - `all`       — edit the master row; every occurrence follows.
   *  - `one`       — upsert an EventOverride for `occurrenceStart`.
   *  - `following` — cap the master's recurrence at `occurrenceStart` and
   *                  split off a new event carrying the change.
   * `occurrenceStart` is the *original* start of the target occurrence; the
   * synthetic id `<masterId>:<iso>` from the windowed list also carries it.
   */
  async update(
    userId: string,
    workspaceId: string,
    id: string,
    input: UpdateEventInput,
    scope: EventScope,
    occurrenceStartISO?: string
  ): Promise<Event> {
    const { masterId, occurrenceStart } = parseId(id, occurrenceStartISO);

    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const master = await this.loadOwned(tx, workspaceId, masterId);
      if (master.readOnly) throw new BadRequestException("Внешнее событие доступно только для чтения");
      if (input.projectId !== undefined) await assertProjectTx(tx, workspaceId, input.projectId);

      if (!master.recurrence || scope === "all") {
        const data = buildUpdateData(input, master.allDay);
        const updated = await tx.event.update({ where: { id: master.id }, data });
        return toDto(updated);
      }

      if (!occurrenceStart) throw new BadRequestException("Для повтора нужен occurrenceStart");

      if (scope === "one") {
        const patch = {
          title: input.title ?? null,
          description: input.description ?? null,
          location: input.location ?? null,
          url: input.url ?? null,
          startAt: input.startAt ? new Date(input.startAt) : null,
          endAt: input.endAt ? new Date(input.endAt) : null,
          colorTag: input.colorTag ?? null
        };
        await tx.eventOverride.upsert({
          where: { eventId_occurrenceStart: { eventId: master.id, occurrenceStart } },
          create: { workspaceId, eventId: master.id, occurrenceStart, canceled: false, ...patch },
          update: { canceled: false, ...patch }
        });
        const start = patch.startAt ?? occurrenceStart;
        const durationMs = master.endAt.getTime() - master.startAt.getTime();
        const end = patch.endAt ?? new Date(occurrenceStart.getTime() + durationMs);
        return occurrenceDto(master, occurrenceStart, start, end, {
          ...patch,
          id: "",
          workspaceId,
          eventId: master.id,
          occurrenceStart,
          canceled: false,
          createdAt: new Date()
        });
      }

      // scope === "following": truncate the master, split off the rest.
      const spec = recurrenceSpecSchema.parse(master.recurrence);
      const cappedUntil = new Date(occurrenceStart.getTime() - 1);
      await tx.event.update({
        where: { id: master.id },
        data: { recurrence: { ...spec, until: cappedUntil.toISOString(), count: null } as Prisma.InputJsonValue }
      });
      const durationMs = master.endAt.getTime() - master.startAt.getTime();
      const newStart = input.startAt ? new Date(input.startAt) : occurrenceStart;
      const created = await tx.event.create({
        data: {
          workspaceId,
          title: input.title ?? master.title,
          description: input.description ?? master.description,
          location: input.location === undefined ? master.location : input.location,
          url: input.url === undefined ? master.url : input.url,
          startAt: newStart,
          endAt: input.endAt ? new Date(input.endAt) : new Date(newStart.getTime() + durationMs),
          allDay: input.allDay ?? master.allDay,
          tz: input.tz === undefined ? master.tz : input.tz,
          colorTag: input.colorTag === undefined ? master.colorTag : input.colorTag,
          recurrence: { ...spec, until: null } as Prisma.InputJsonValue,
          reminders: input.reminders ?? master.reminders,
          projectId: input.projectId === undefined ? master.projectId : input.projectId
        }
      });
      return toDto(created);
    });
  }

  async remove(
    userId: string,
    workspaceId: string,
    id: string,
    scope: EventScope,
    occurrenceStartISO?: string
  ): Promise<void> {
    const { masterId, occurrenceStart } = parseId(id, occurrenceStartISO);
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const master = await this.loadOwned(tx, workspaceId, masterId);
      if (master.readOnly) throw new BadRequestException("Внешнее событие доступно только для чтения");

      if (!master.recurrence || scope === "all") {
        await tx.event.delete({ where: { id: master.id } });
        return;
      }
      if (!occurrenceStart) throw new BadRequestException("Для повтора нужен occurrenceStart");

      if (scope === "one") {
        await tx.eventOverride.upsert({
          where: { eventId_occurrenceStart: { eventId: master.id, occurrenceStart } },
          create: { workspaceId, eventId: master.id, occurrenceStart, canceled: true },
          update: { canceled: true }
        });
        return;
      }
      const spec = recurrenceSpecSchema.parse(master.recurrence);
      await tx.event.update({
        where: { id: master.id },
        data: {
          recurrence: {
            ...spec,
            until: new Date(occurrenceStart.getTime() - 1).toISOString(),
            count: null
          } as Prisma.InputJsonValue
        }
      });
    });
  }

  /**
   * The read-only .ics document for a workspace's feed token. No auth guard
   * on the route — the token is the credential — so this runs `asSystem`
   * and is scoped strictly to the single workspace the token resolves to.
   * Emits recurring events as one VEVENT + RRULE (+ EXDATE for canceled
   * occurrences); modified occurrences become standalone VEVENTs with
   * RECURRENCE-ID. Tasks with a due date are included as short VEVENTs.
   */
  async feedByToken(token: string): Promise<{ name: string; body: string } | null> {
    return this.prisma.asSystem(async (tx) => {
      const workspace = await tx.workspace.findUnique({ where: { icsToken: token } });
      if (!workspace || workspace.disabledModules.includes("calendar") || workspace.pluginOverrides.includes("calendar-external")) return null;

      const events = await tx.event.findMany({
        where: { workspaceId: workspace.id },
        include: { overrides: true }
      });
      const tasks = workspace.disabledModules.includes("tasks")
        ? []
        : await tx.task.findMany({
            where: { workspaceId: workspace.id, dueAt: { not: null } }
          });

      const entries: ICalEntry[] = [];
      for (const ev of events) {
        const spec = ev.recurrence ? recurrenceSpecSchema.parse(ev.recurrence) : null;
        entries.push({
          uid: `event-${ev.id}@orion`,
          start: ev.startAt,
          end: ev.endAt,
          allDay: ev.allDay,
          summary: ev.title,
          description: ev.description || null,
          location: ev.location,
          url: ev.url,
          rrule: spec ? recurrenceToRRule(spec) : null,
          exdates: ev.overrides.filter((o) => o.canceled).map((o) => o.occurrenceStart)
        });
        for (const ovr of ev.overrides) {
          if (ovr.canceled) continue;
          const durationMs = ev.endAt.getTime() - ev.startAt.getTime();
          entries.push({
            uid: `event-${ev.id}@orion`,
            recurrenceId: ovr.occurrenceStart,
            start: ovr.startAt ?? ovr.occurrenceStart,
            end: ovr.endAt ?? new Date(ovr.occurrenceStart.getTime() + durationMs),
            allDay: ev.allDay,
            summary: ovr.title ?? ev.title,
            description: ovr.description ?? ev.description ?? null,
            location: ovr.location ?? ev.location,
            url: ovr.url ?? ev.url
          });
        }
      }
      for (const task of tasks) {
        if (!task.dueAt) continue;
        entries.push({
          uid: `task-${task.id}@orion`,
          start: task.dueAt,
          end: new Date(task.dueAt.getTime() + 15 * 60 * 1000),
          allDay: false,
          summary: `${task.status === "done" ? "✓ " : ""}${task.projectTag ? `[${task.projectTag}] ` : ""}${task.title}`,
          description: task.description || null
        });
      }

      return { name: `ORION — ${workspace.name}`, body: buildICal(`ORION — ${workspace.name}`, entries) };
    });
  }

  /** The subscription URL + token for the settings UI. Mints a token on first read. */
  async feedInfo(userId: string, workspaceId: string): Promise<CalendarFeedInfo> {
    const token = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (ws?.icsToken) return ws.icsToken;
      const fresh = newFeedToken();
      await tx.workspace.update({ where: { id: workspaceId }, data: { icsToken: fresh } });
      return fresh;
    });
    return { token, url: feedUrl(token) };
  }

  /** Invalidates the old subscription URL and returns a new one. */
  async rotateFeedToken(userId: string, workspaceId: string): Promise<CalendarFeedInfo> {
    const token = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const fresh = newFeedToken();
      await tx.workspace.update({ where: { id: workspaceId }, data: { icsToken: fresh } });
      return fresh;
    });
    return { token, url: feedUrl(token) };
  }

  private async loadOwned(tx: Prisma.TransactionClient, workspaceId: string, id: string): Promise<EventModel> {
    const event = await tx.event.findUnique({ where: { id } });
    if (!event || event.workspaceId !== workspaceId) throw new NotFoundException("Событие не найдено");
    return event;
  }
}

function newFeedToken(): string {
  return randomBytes(24).toString("base64url");
}

/** `webcal://…` so a calendar app subscribes read-only instead of downloading once. */
function feedUrl(token: string): string {
  const base = process.env.PUBLIC_API_URL || "http://localhost:4000";
  return `${base.replace(/^https?:\/\//, "webcal://").replace(/\/$/, "")}/calendar/${token}.ics`;
}

/** `<masterId>:<iso>` (from the windowed list) or a plain id + optional explicit `occurrenceStart`. */
function parseId(id: string, explicitISO?: string): { masterId: string; occurrenceStart: Date | null } {
  const colon = id.indexOf(":");
  if (colon > -1) {
    const iso = id.slice(colon + 1);
    return { masterId: id.slice(0, colon), occurrenceStart: new Date(iso) };
  }
  return { masterId: id, occurrenceStart: explicitISO ? new Date(explicitISO) : null };
}

/** All-day ranges snap to midnight-UTC day boundaries so tz never shifts them. */
function normaliseRange(startISO: string, endISO: string, allDay: boolean): { startAt: Date; endAt: Date } {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!allDay) return { startAt: start, endAt: end };
  const dayStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const dayEndBase = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  // Exclusive end: at least the day after dayStart.
  const dayEnd = dayEndBase <= dayStart ? new Date(dayStart.getTime() + 86_400_000) : new Date(dayEndBase.getTime() + 86_400_000);
  return { startAt: dayStart, endAt: dayEnd };
}

function buildUpdateData(input: UpdateEventInput, allDay: boolean): Prisma.EventUpdateInput {
  const data: Prisma.EventUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.location !== undefined) data.location = input.location;
  if (input.url !== undefined) data.url = input.url;
  if (input.allDay !== undefined) data.allDay = input.allDay;
  if (input.tz !== undefined) data.tz = input.tz;
  if (input.colorTag !== undefined) data.colorTag = input.colorTag;
  if (input.reminders !== undefined) data.reminders = input.reminders;
  if (input.projectId !== undefined) data.project = input.projectId ? { connect: { id: input.projectId } } : { disconnect: true };
  if (input.recurrence !== undefined) {
    data.recurrence = input.recurrence
      ? (recurrenceSpecSchema.parse(input.recurrence) as Prisma.InputJsonValue)
      : Prisma.DbNull;
  }
  if (input.startAt !== undefined || input.endAt !== undefined) {
    const effectiveAllDay = input.allDay ?? allDay;
    if (input.startAt !== undefined && input.endAt !== undefined) {
      const { startAt, endAt } = normaliseRange(input.startAt, input.endAt, effectiveAllDay);
      data.startAt = startAt;
      data.endAt = endAt;
    } else {
      if (input.startAt !== undefined) data.startAt = new Date(input.startAt);
      if (input.endAt !== undefined) data.endAt = new Date(input.endAt);
    }
  }
  return data;
}

function toDto(event: EventModel): Event {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    projectId: event.projectId,
    title: event.title,
    description: event.description,
    location: event.location,
    url: event.url,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
    allDay: event.allDay,
    tz: event.tz,
    colorTag: event.colorTag,
    recurrence: event.recurrence ? (event.recurrence as unknown as RecurrenceSpec) : null,
    reminders: event.reminders,
    source: event.source,
    readOnly: event.readOnly,
    calendarConnectionId: event.calendarConnectionId,
    recurringEventId: null,
    occurrenceStart: null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

async function assertProjectTx(tx: Prisma.TransactionClient, workspaceId: string, projectId: string | null): Promise<void> {
  if (!projectId) return;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project || project.workspaceId !== workspaceId) throw new NotFoundException("Проект не найден");
}

/** A virtual event for one occurrence of a recurring master, overrides applied. */
function occurrenceDto(
  master: EventModel,
  occurrenceStart: Date,
  start: Date,
  end: Date,
  ovr: OverrideModel | null
): Event {
  return {
    ...toDto(master),
    id: `${master.id}:${occurrenceStart.toISOString()}`,
    title: ovr?.title ?? master.title,
    description: ovr?.description ?? master.description,
    location: ovr?.location ?? master.location,
    url: ovr?.url ?? master.url,
    colorTag: ovr?.colorTag ?? master.colorTag,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    // The occurrence itself is not independently recurring.
    recurrence: master.recurrence ? (master.recurrence as unknown as RecurrenceSpec) : null,
    recurringEventId: master.id,
    occurrenceStart: occurrenceStart.toISOString()
  };
}
