import { describe, expect, it } from "vitest";
import { isOnboardingPending, isWithinQuietHours, localMinutesOfDay, parseClockMinutes, type UserPreference } from "./settings";

// Quiet hours are the one piece of the preferences that both the API (gating
// Telegram/in-app reminders) and the desktop shell (gating native toasts)
// evaluate — so the edge cases are pinned here rather than in either caller.

describe("parseClockMinutes", () => {
  it("accepts the shapes an <input type=time> can produce", () => {
    expect(parseClockMinutes("23:00")).toBe(23 * 60);
    expect(parseClockMinutes("9:05")).toBe(9 * 60 + 5);
    expect(parseClockMinutes("23:00:00")).toBe(23 * 60);
    expect(parseClockMinutes(" 07:30 ")).toBe(7 * 60 + 30);
  });

  it("rejects anything else", () => {
    for (const value of ["", "24:00", "23:60", "2300", "abc", null, undefined]) {
      expect(parseClockMinutes(value)).toBeNull();
    }
  });
});

describe("localMinutesOfDay", () => {
  it("reads the wall clock in the requested zone", () => {
    const at = new Date("2026-01-15T20:30:00.000Z");
    expect(localMinutesOfDay(at, "UTC")).toBe(20 * 60 + 30);
    expect(localMinutesOfDay(at, "Europe/Moscow")).toBe(23 * 60 + 30); // UTC+3
    expect(localMinutesOfDay(at, "Asia/Almaty")).toBe(1 * 60 + 30); // UTC+5 → 01:30 next day
  });

  it("falls back to the host zone instead of throwing on an unknown zone", () => {
    const at = new Date("2026-01-15T20:30:00.000Z");
    expect(() => localMinutesOfDay(at, "Not/AZone")).not.toThrow();
    expect(localMinutesOfDay(at, "Not/AZone")).toBe(localMinutesOfDay(at, null));
  });
});

describe("isWithinQuietHours", () => {
  const utc = (iso: string): Date => new Date(iso);
  // Every case below passes the zone explicitly: the suite must not depend on
  // the machine's own timezone (it caught exactly that while being written).
  const utcWindow = (start: string, end: string, iso: string): boolean =>
    isWithinQuietHours(start, end, utc(iso), "UTC");

  it("is never quiet when a bound is missing or invalid", () => {
    expect(isWithinQuietHours(null, "07:00", utc("2026-01-15T23:30:00Z"), "UTC")).toBe(false);
    expect(isWithinQuietHours("23:00", null, utc("2026-01-15T23:30:00Z"), "UTC")).toBe(false);
    expect(isWithinQuietHours("nonsense", "07:00", utc("2026-01-15T23:30:00Z"), "UTC")).toBe(false);
  });

  it("treats equal bounds as an empty window, not as all day", () => {
    expect(isWithinQuietHours("08:00", "08:00", utc("2026-01-15T08:00:00Z"), "UTC")).toBe(false);
  });

  it("handles a window that crosses midnight", () => {
    expect(utcWindow("23:00", "07:00", "2026-01-15T23:30:00Z")).toBe(true);
    expect(utcWindow("23:00", "07:00", "2026-01-15T23:00:00Z")).toBe(true);
    expect(utcWindow("23:00", "07:00", "2026-01-16T06:59:00Z")).toBe(true);
    // The end bound is exclusive: 07:00 is already "morning".
    expect(utcWindow("23:00", "07:00", "2026-01-16T07:00:00Z")).toBe(false);
    expect(utcWindow("23:00", "07:00", "2026-01-15T12:00:00Z")).toBe(false);
  });

  it("handles a daytime window", () => {
    expect(utcWindow("09:00", "17:00", "2026-01-15T12:00:00Z")).toBe(true);
    expect(utcWindow("09:00", "17:00", "2026-01-15T08:59:00Z")).toBe(false);
    expect(utcWindow("09:00", "17:00", "2026-01-15T17:00:00Z")).toBe(false);
  });

  it("evaluates the window in the user's zone, not the server's", () => {
    const lateEveningUtc = utc("2026-01-15T20:30:00Z"); // 23:30 in Moscow
    expect(isWithinQuietHours("23:00", "23:59", lateEveningUtc, "UTC")).toBe(false);
    expect(isWithinQuietHours("23:00", "23:59", lateEveningUtc, "Europe/Moscow")).toBe(true);
  });

  it("uses the host zone when the user has not set one", () => {
    // Whatever the machine's zone is, the answer must equal the same window
    // evaluated against the host's own wall clock.
    const at = utc("2026-01-15T20:30:00Z");
    const hostMinutes = localMinutesOfDay(at, null);
    const expected = hostMinutes >= 23 * 60 || hostMinutes < 7 * 60;
    expect(isWithinQuietHours("23:00", "07:00", at, null)).toBe(expected);
  });
});

describe("isOnboardingPending", () => {
  it("is pending only when preferences loaded and the card was never dismissed", () => {
    expect(isOnboardingPending(undefined)).toBe(false);
    expect(isOnboardingPending(null)).toBe(false);
    expect(isOnboardingPending({ onboardingCompletedAt: null } as UserPreference)).toBe(true);
    expect(isOnboardingPending({ onboardingCompletedAt: "2026-09-15T12:00:00.000Z" } as UserPreference)).toBe(false);
  });
});
