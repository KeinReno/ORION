import { describe, expect, it } from "vitest";
import { allDayAnchor } from "./shared";

// events.service.ts normaliseRange() (apps/api/src/events/events.service.ts)
// snaps `allDay` events to UTC-midnight day boundaries — that's the
// "date-only" contract for an all-day event, distinct from a timed event's
// real instant (same date-only-vs-instant principle as habits' local day
// key). MonthGrid/TimeGrid bucket calendar items by calendar day using the
// viewer's LOCAL Date getters (see shared.ts `startOfDay`/`dateKey`). Naively
// calling `new Date(item.start)` on that UTC-midnight instant and reading its
// local day is wrong for any viewer whose UTC offset crosses the boundary
// (west-of-UTC viewers land the instant on the *previous* local day) — the
// all-day pill silently renders one day early. `allDayAnchor` must re-anchor
// the UTC calendar date onto local midnight so day-bucketing always reflects
// the date the event contract means, independent of the runtime's own
// timezone (this assertion is written not to depend on the test machine's
// offset, since Node on Windows does not honour a `TZ` env var override).
describe("allDayAnchor", () => {
  it("returns a local date whose Y/M/D match the input's UTC Y/M/D, not a reinterpreted instant", () => {
    const iso = "2024-01-15T00:00:00.000Z";
    const anchored = allDayAnchor(iso);
    const utc = new Date(iso);

    expect(anchored.getFullYear()).toBe(utc.getUTCFullYear());
    expect(anchored.getMonth()).toBe(utc.getUTCMonth());
    expect(anchored.getDate()).toBe(utc.getUTCDate());
    // And it's local midnight, not carrying a time-of-day that could tip it
    // into the wrong day again during later arithmetic (addDays/startOfDay).
    expect(anchored.getHours()).toBe(0);
    expect(anchored.getMinutes()).toBe(0);
  });

  it("agrees with a naive `new Date(iso)` read whenever the offset does not cross midnight (sanity check)", () => {
    // A UTC-midnight instant read directly in a zone with a *positive* UTC
    // offset never crosses into the previous local day, so the naive local
    // read and allDayAnchor's local Y/M/D must still agree there — the bug
    // is one-directional (west-of-UTC only), and this pins that shape down.
    const iso = "2024-06-01T00:00:00.000Z";
    const naive = new Date(iso);
    if (naive.getTimezoneOffset() <= 0) {
      // getTimezoneOffset() <= 0 means the local zone is at/ahead of UTC.
      const anchored = allDayAnchor(iso);
      expect(anchored.getFullYear()).toBe(naive.getFullYear());
      expect(anchored.getMonth()).toBe(naive.getMonth());
      expect(anchored.getDate()).toBe(naive.getDate());
    }
  });
});
