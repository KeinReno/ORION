import { describe, expect, it } from "vitest";
import {
  entryMinutes,
  formatDuration,
  startTimerInputSchema,
  summarizeByAuthorship,
  timeCostMinor,
  type TimeEntry
} from "./time";

// `entryMinutes` is shared by the API (the DTO's `minutes`) and the client
// (the live ticker), so its edges matter: a running timer must agree with the
// stored one the moment it stops.

describe("entryMinutes", () => {
  const at = (iso: string): string => new Date(iso).toISOString();

  it("measures a finished entry", () => {
    expect(entryMinutes({ startedAt: at("2026-09-10T09:00:00Z"), endedAt: at("2026-09-10T11:30:00Z") })).toBe(150);
  });

  it("measures a running entry up to `now`", () => {
    const startedAt = at("2026-09-10T09:00:00Z");
    const now = new Date("2026-09-10T09:45:00Z");
    expect(entryMinutes({ startedAt, endedAt: null }, now)).toBe(45);
  });

  it("rounds to whole minutes", () => {
    const startedAt = at("2026-09-10T09:00:20Z");
    const endedAt = at("2026-09-10T09:01:10Z"); // 50s
    expect(entryMinutes({ startedAt, endedAt })).toBe(1);
  });

  it("never goes negative or NaN", () => {
    // A clock skew or a hand-edited range must not produce "-3 мин" in the UI.
    expect(entryMinutes({ startedAt: at("2026-09-10T11:00:00Z"), endedAt: at("2026-09-10T09:00:00Z") })).toBe(0);
    expect(entryMinutes({ startedAt: "not-a-date", endedAt: null })).toBe(0);
  });
});

describe("formatDuration", () => {
  it("renders minutes, hours and both", () => {
    expect(formatDuration(0)).toBe("0 мин");
    expect(formatDuration(45)).toBe("45 мин");
    expect(formatDuration(60)).toBe("1 ч");
    expect(formatDuration(125)).toBe("2 ч 05 мин");
    expect(formatDuration(-10)).toBe("0 мин");
  });
});

describe("timeCostMinor", () => {
  it("multiplies minutes by an hourly rate in kopecks", () => {
    // 90 минут по 2000 ₽/час (200000 копеек) = 3000 ₽.
    expect(timeCostMinor(90, 200_000)).toBe(300_000);
  });

  it("rounds to whole kopecks", () => {
    expect(timeCostMinor(20, 100_000)).toBe(33_333);
  });

  it("returns null for an unknown rate instead of pretending it is free", () => {
    // The whole point: a missing rate must not silently add 0 to a total.
    expect(timeCostMinor(120, null)).toBeNull();
    expect(timeCostMinor(120, undefined)).toBeNull();
  });

  it("treats an explicit zero rate as free, not unknown", () => {
    expect(timeCostMinor(120, 0)).toBe(0);
  });
});

describe("summarizeByAuthorship", () => {
  // Minimal fixture — only the fields the function reads matter.
  function entry(overrides: Partial<TimeEntry>): TimeEntry {
    return {
      id: "e",
      workspaceId: "w",
      userId: null,
      mine: false,
      taskId: null,
      projectId: null,
      note: "",
      startedAt: "2026-09-10T09:00:00.000Z",
      endedAt: "2026-09-10T10:00:00.000Z",
      pausedSeconds: 0,
      pausedAt: null,
      editedAt: null,
      edits: [],
      minutes: 60,
      running: false,
      createdAt: "2026-09-10T09:00:00.000Z",
      updatedAt: "2026-09-10T09:00:00.000Z",
      ...overrides
    };
  }

  it("buckets mine / team / unknown-author and never double-counts", () => {
    const entries: TimeEntry[] = [
      entry({ id: "1", userId: "u1", mine: true, minutes: 30 }), // мои
      entry({ id: "2", userId: "u2", mine: false, minutes: 45 }), // команда
      entry({ id: "3", userId: null, mine: false, minutes: 15 }) // автор неизвестен (legacy)
    ];

    const totals = summarizeByAuthorship(entries);

    expect(totals).toEqual({ mineMinutes: 30, teamMinutes: 45, unknownAuthorMinutes: 15 });
    // Инвариант: сумма трёх корзин равна сумме всех entries.minutes.
    const total = entries.reduce((sum, e) => sum + e.minutes, 0);
    expect(totals.mineMinutes + totals.teamMinutes + totals.unknownAuthorMinutes).toBe(total);
  });

  it("a legacy row (userId=null) never falls into mine or team even if mine=true", () => {
    // `mine` is only meaningful when `userId` is known — a null userId is
    // "unknown author", not "not mine", so it must go to the unknown bucket
    // regardless of what `mine` happens to be on the wire.
    const totals = summarizeByAuthorship([entry({ id: "1", userId: null, mine: true, minutes: 20 })]);
    expect(totals).toEqual({ mineMinutes: 0, teamMinutes: 0, unknownAuthorMinutes: 20 });
  });

  it("returns all zeros for an empty list", () => {
    expect(summarizeByAuthorship([])).toEqual({ mineMinutes: 0, teamMinutes: 0, unknownAuthorMinutes: 0 });
  });
});

describe("startTimerInputSchema", () => {
  it("defaults the note and accepts an empty body", () => {
    expect(startTimerInputSchema.parse({})).toEqual({ note: "" });
  });

  it("lets a timer run without a task (project-only tracking)", () => {
    expect(startTimerInputSchema.safeParse({ projectId: "p1" }).success).toBe(true);
    expect(startTimerInputSchema.safeParse({ taskId: null, projectId: null }).success).toBe(true);
  });
});

describe("entryMinutes with pause (задание 04)", () => {
  const start = "2026-11-11T09:00:00.000Z";

  it("subtracts the accumulated pause from the worked minutes", () => {
    // 09:00–10:00 минус 15 минут паузы = 45.
    expect(entryMinutes({ startedAt: start, endedAt: "2026-11-11T10:00:00.000Z", pausedSeconds: 15 * 60 })).toBe(45);
  });

  it("freezes the running timer while the pause is open", () => {
    // Идёт пауза с 09:30, «сейчас» 10:00 — длительность стоит на 30 минутах.
    const entry = { startedAt: start, endedAt: null, pausedSeconds: 0, pausedAt: "2026-11-11T09:30:00.000Z" };
    expect(entryMinutes(entry, new Date("2026-11-11T10:00:00.000Z"))).toBe(30);
    // Через час паузы — те же 30 минут: время на паузе не капает.
    expect(entryMinutes(entry, new Date("2026-11-11T11:00:00.000Z"))).toBe(30);
  });

  it("combines closed and open pauses", () => {
    const entry = {
      startedAt: start,
      endedAt: "2026-11-11T10:00:00.000Z",
      pausedSeconds: 10 * 60,
      pausedAt: "2026-11-11T09:50:00.000Z"
    };
    // 60 минут работы минус 10 закрытых и 10 текущих = 40.
    expect(entryMinutes(entry, new Date("2026-11-11T11:00:00.000Z"))).toBe(40);
  });

  it("never goes negative when the pause is longer than the elapsed time", () => {
    expect(entryMinutes({ startedAt: start, endedAt: "2026-11-11T10:00:00.000Z", pausedSeconds: 9_999 })).toBe(0);
  });
});
