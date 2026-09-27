import { describe, expect, it } from "vitest";
import { eventReschedulePatch, shiftAllDayIso } from "./calendar-reschedule";

// Local noon of a local calendar day — exactly what MonthGrid's `dayToISO` sends.
function localNoon(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

describe("eventReschedulePatch", () => {
  it("month-grid drop of an all-day event keeps the date-only contract and its span", () => {
    const event = { startAt: "2026-09-10T00:00:00.000Z", endAt: "2026-09-12T00:00:00.000Z", allDay: true };
    expect(eventReschedulePatch(event, { start: localNoon(2026, 9, 20) })).toEqual({
      startAt: "2026-09-20T00:00:00.000Z",
      endAt: "2026-09-22T00:00:00.000Z",
      allDay: true
    });
  });

  it("month-grid drop of a timed event keeps its local time of day and duration", () => {
    const start = new Date(2026, 8, 10, 15, 30);
    const end = new Date(2026, 8, 10, 17, 0);
    const patch = eventReschedulePatch(
      { startAt: start.toISOString(), endAt: end.toISOString(), allDay: false },
      { start: localNoon(2026, 9, 14) }
    );
    expect(patch.allDay).toBe(false);
    expect(new Date(patch.startAt)).toEqual(new Date(2026, 8, 14, 15, 30));
    expect(new Date(patch.endAt).getTime() - new Date(patch.startAt).getTime()).toBe(90 * 60_000);
  });

  it("all-day band drop anchors on the UTC date it was given, keeping a multi-day span", () => {
    const event = { startAt: "2026-09-10T00:00:00.000Z", endAt: "2026-09-13T00:00:00.000Z", allDay: true };
    expect(
      eventReschedulePatch(event, { start: "2026-09-01T00:00:00.000Z", end: "2026-09-02T00:00:00.000Z", allDay: true })
    ).toEqual({ startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-04T00:00:00.000Z", allDay: true });
  });

  it("all-day band drop turns a timed event into a single all-day day", () => {
    const patch = eventReschedulePatch(
      { startAt: "2026-09-10T09:00:00.000Z", endAt: "2026-09-10T10:00:00.000Z", allDay: false },
      { start: "2026-09-05T00:00:00.000Z", end: "2026-09-06T00:00:00.000Z", allDay: true }
    );
    expect(patch).toEqual({ startAt: "2026-09-05T00:00:00.000Z", endAt: "2026-09-06T00:00:00.000Z", allDay: true });
  });

  it("hour-grid move/resize passes the instants through", () => {
    const drop = { start: "2026-09-10T09:00:00.000Z", end: "2026-09-10T11:00:00.000Z" };
    expect(
      eventReschedulePatch({ startAt: "2026-09-09T09:00:00.000Z", endAt: "2026-09-09T10:00:00.000Z", allDay: false }, drop)
    ).toEqual({ startAt: drop.start, endAt: drop.end, allDay: false });
  });
});

describe("shiftAllDayIso", () => {
  it("moves by whole UTC days and stays on UTC midnight", () => {
    expect(shiftAllDayIso("2026-10-24T00:00:00.000Z", 1)).toBe("2026-10-25T00:00:00.000Z");
    expect(shiftAllDayIso("2026-03-29T00:00:00.000Z", -1)).toBe("2026-03-28T00:00:00.000Z");
  });
});
