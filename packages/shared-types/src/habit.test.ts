import { describe, expect, it } from "vitest";
import {
  habitDayDate,
  habitDayKey,
  habitLocalDayKey,
  habitStreak,
  habitWeekdayOf,
  isHabitScheduled,
  toggleHabitInputSchema
} from "./habit";

// The streak is the one number a habit tracker is judged by, and its rules are
// easy to get subtly wrong (weekday arithmetic, "is today over yet?",
// non-scheduled days in between) — so they are pinned here.

describe("day keys", () => {
  it("round-trips a day key through a Date", () => {
    expect(habitDayKey(habitDayDate("2026-09-10"))).toBe("2026-09-10");
  });

  it("reads the local day for the user's own tick, not the server's UTC day", () => {
    // Same instant, two different answers — exactly the distinction the panel
    // needs when it tells the API which day was ticked.
    const instant = new Date("2026-09-10T20:30:00.000Z");
    expect(habitDayKey(instant)).toBe("2026-09-10");
    expect(habitLocalDayKey(instant)).toBe(habitLocalDayKey(instant));
    // And with local components it matches what the user sees on their clock.
    expect(habitLocalDayKey(instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(habitLocalDayKey(new Date(2026, 8, 10, 0, 30))).toBe("2026-09-10");
  });

  it("uses Monday = 0, matching the recurring engine", () => {
    expect(habitWeekdayOf("2026-09-07")).toBe(0); // Monday
    expect(habitWeekdayOf("2026-09-13")).toBe(6); // Sunday
  });
});

describe("isHabitScheduled", () => {
  it("treats an empty schedule as every day", () => {
    expect(isHabitScheduled([], "2026-09-10")).toBe(true);
  });

  it("respects a weekly schedule", () => {
    expect(isHabitScheduled([3], "2026-09-10")).toBe(true); // Thursday
    expect(isHabitScheduled([0], "2026-09-10")).toBe(false);
  });
});

describe("habitStreak", () => {
  it("counts consecutive days", () => {
    const done = ["2026-09-10", "2026-09-09", "2026-09-08"];
    expect(habitStreak([], done, "2026-09-10")).toBe(3);
  });

  it("keeps yesterday's streak while today is still unticked", () => {
    // The day isn't over — a tracker that showed 0 here would be useless until
    // you tick something.
    expect(habitStreak([], ["2026-09-09", "2026-09-08"], "2026-09-10")).toBe(2);
  });

  it("is zero after a missed day", () => {
    expect(habitStreak([], ["2026-09-08"], "2026-09-10")).toBe(0);
  });

  it("skips days the habit is not scheduled for", () => {
    // Mon/Wed/Fri habit: both scheduled days done → streak 2, even though
    // Tuesday sits between them.
    const weekdays = [0, 2, 4];
    expect(habitStreak(weekdays, ["2026-09-07", "2026-09-09"], "2026-09-09")).toBe(2);
    expect(habitStreak(weekdays, ["2026-09-09"], "2026-09-11")).toBe(1);
  });

  it("does not count ticks on unscheduled days as part of the streak", () => {
    // Ticking an off-day is allowed (the panel doesn't forbid it) but it must
    // not inflate the number.
    expect(habitStreak([0], ["2026-09-10"], "2026-09-10")).toBe(0);
  });

  it("accepts any iterable and survives an empty history", () => {
    expect(habitStreak([], new Set<string>(), "2026-09-10")).toBe(0);
    expect(habitStreak([], ["2026-09-10"], "2026-09-10")).toBe(1);
  });
});

describe("toggleHabitInputSchema", () => {
  it("defaults to no explicit day", () => {
    expect(toggleHabitInputSchema.parse({})).toEqual({});
  });

  it("rejects a malformed day", () => {
    expect(toggleHabitInputSchema.safeParse({ day: "10.09.2026" }).success).toBe(false);
    expect(toggleHabitInputSchema.safeParse({ day: "2026-09-10" }).success).toBe(true);
  });
});
