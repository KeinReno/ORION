import { describe, expect, it } from "vitest";
import { describeRecurrence, expandRecurrence, recurrenceToRRule, type RecurrenceSpec } from "./recurrence";

const iso = (d: Date): string => d.toISOString();
const D = (s: string): Date => new Date(s);

describe("expandRecurrence", () => {
  it("daily rule yields every day in the window, including the anchor", () => {
    const spec: RecurrenceSpec = { freq: "daily", interval: 1, until: null, count: null };
    const out = expandRecurrence(spec, D("2026-03-02T09:00:00.000Z"), D("2026-03-02T00:00:00.000Z"), D("2026-03-05T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-02T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
      "2026-03-04T09:00:00.000Z"
    ]);
  });

  it("interval skips periods", () => {
    const spec: RecurrenceSpec = { freq: "daily", interval: 3, until: null, count: null };
    const out = expandRecurrence(spec, D("2026-03-01T00:00:00.000Z"), D("2026-03-01T00:00:00.000Z"), D("2026-03-15T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-04T00:00:00.000Z",
      "2026-03-07T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
      "2026-03-13T00:00:00.000Z"
    ]);
  });

  it("weekly byWeekday fires on each listed day and never before the anchor", () => {
    // 2026-03-04 is a Wednesday. byWeekday = [0,2] => Mon, Wed.
    const spec: RecurrenceSpec = { freq: "weekly", interval: 1, byWeekday: [0, 2], until: null, count: null };
    const out = expandRecurrence(spec, D("2026-03-04T12:00:00.000Z"), D("2026-03-01T00:00:00.000Z"), D("2026-03-18T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-04T12:00:00.000Z", // Wed (anchor) — Mon of that week is skipped
      "2026-03-09T12:00:00.000Z", // Mon
      "2026-03-11T12:00:00.000Z", // Wed
      "2026-03-16T12:00:00.000Z" // Mon
    ]);
  });

  it("every 2 weeks respects the interval between weeks", () => {
    const spec: RecurrenceSpec = { freq: "weekly", interval: 2, byWeekday: [4], until: null, count: null };
    // 2026-03-06 is a Friday (weekday 4).
    const out = expandRecurrence(spec, D("2026-03-06T08:00:00.000Z"), D("2026-03-01T00:00:00.000Z"), D("2026-04-10T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-06T08:00:00.000Z",
      "2026-03-20T08:00:00.000Z",
      "2026-04-03T08:00:00.000Z"
    ]);
  });

  it("monthly clamps to the last day of a shorter month", () => {
    const spec: RecurrenceSpec = { freq: "monthly", interval: 1, until: null, count: null };
    const out = expandRecurrence(spec, D("2026-01-31T10:00:00.000Z"), D("2026-01-01T00:00:00.000Z"), D("2026-05-01T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-02-28T10:00:00.000Z", // clamped, not rolled into March
      "2026-03-31T10:00:00.000Z",
      "2026-04-30T10:00:00.000Z"
    ]);
  });

  it("yearly clamps Feb 29 to Feb 28 on non-leap years", () => {
    const spec: RecurrenceSpec = { freq: "yearly", interval: 1, until: null, count: null };
    const out = expandRecurrence(spec, D("2024-02-29T00:00:00.000Z"), D("2024-01-01T00:00:00.000Z"), D("2027-06-01T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2024-02-29T00:00:00.000Z",
      "2025-02-28T00:00:00.000Z",
      "2026-02-28T00:00:00.000Z",
      "2027-02-28T00:00:00.000Z"
    ]);
  });

  it("count is measured from the series start, not the window", () => {
    const spec: RecurrenceSpec = { freq: "daily", interval: 1, until: null, count: 3 };
    // Window starts after occurrence #2 — only #3 remains, #4+ never exist.
    const out = expandRecurrence(spec, D("2026-03-01T00:00:00.000Z"), D("2026-03-03T00:00:00.000Z"), D("2026-03-30T00:00:00.000Z"));
    expect(out.map(iso)).toEqual(["2026-03-03T00:00:00.000Z"]);
  });

  it("until is an inclusive upper bound", () => {
    const spec: RecurrenceSpec = { freq: "daily", interval: 1, until: "2026-03-03T00:00:00.000Z", count: null };
    const out = expandRecurrence(spec, D("2026-03-01T00:00:00.000Z"), D("2026-03-01T00:00:00.000Z"), D("2026-03-30T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
      "2026-03-03T00:00:00.000Z"
    ]);
  });

  it("keeps the UTC clock time across a DST boundary (documented limitation)", () => {
    // EU DST starts 2026-03-29. A 07:00Z daily event stays 07:00Z either
    // side — wall-clock in a DST zone shifts by an hour. This asserts the
    // engine's actual (zone-naive) behaviour so a future change is visible.
    const spec: RecurrenceSpec = { freq: "daily", interval: 1, until: null, count: null };
    const out = expandRecurrence(spec, D("2026-03-28T07:00:00.000Z"), D("2026-03-28T00:00:00.000Z"), D("2026-03-31T00:00:00.000Z"));
    expect(out.map(iso)).toEqual([
      "2026-03-28T07:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z"
    ]);
  });

  it("terminates on a far-future window instead of hanging", () => {
    const spec: RecurrenceSpec = { freq: "daily", interval: 1, until: null, count: null };
    const out = expandRecurrence(spec, D("2000-01-01T00:00:00.000Z"), D("2999-01-01T00:00:00.000Z"), D("2999-02-01T00:00:00.000Z"));
    expect(out.length).toBe(0); // MAX_ITERATIONS reached before the window
  });
});

describe("recurrenceToRRule", () => {
  it("serialises a plain weekly rule", () => {
    expect(recurrenceToRRule({ freq: "weekly", interval: 1, until: null, count: null })).toBe("FREQ=WEEKLY;INTERVAL=1");
  });

  it("includes BYDAY and COUNT", () => {
    expect(
      recurrenceToRRule({ freq: "weekly", interval: 2, byWeekday: [0, 2, 4], until: null, count: 10 })
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10");
  });

  it("serialises UNTIL as a UTC stamp", () => {
    expect(
      recurrenceToRRule({ freq: "daily", interval: 1, until: "2026-03-03T00:00:00.000Z", count: null })
    ).toBe("FREQ=DAILY;INTERVAL=1;UNTIL=20260303T000000Z");
  });
});

describe("describeRecurrence", () => {
  it("reads naturally in Russian", () => {
    expect(describeRecurrence({ freq: "daily", interval: 1, until: null, count: null })).toBe("ежедневно");
    expect(describeRecurrence({ freq: "weekly", interval: 2, byWeekday: [0, 2], until: null, count: null })).toBe(
      "каждые 2 нед. по пн, ср"
    );
    expect(describeRecurrence({ freq: "monthly", interval: 1, until: null, count: 6 })).toBe("ежемесячно, 6 раз");
  });
});
