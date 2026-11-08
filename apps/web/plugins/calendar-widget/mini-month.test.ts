import { describe, expect, it } from "vitest";
import { buildMiniMonth, currentWeekCells, localDayKey, markDays, miniMonthRange } from "./mini-month";

describe("buildMiniMonth", () => {
  it("is always 42 cells, starts on Monday and flags today and the month", () => {
    // October 2026 starts on Thursday → grid begins Monday 28 September.
    const cells = buildMiniMonth(2026, 9, new Date(2026, 9, 13, 15, 0));
    expect(cells).toHaveLength(42);
    expect(cells[0].key).toBe("2026-09-28");
    expect(cells[0].inMonth).toBe(false);
    expect(cells.find((c) => c.isToday)?.key).toBe("2026-10-13");
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });

  it("a month starting on Monday begins with its first day", () => {
    const cells = buildMiniMonth(2026, 5, new Date(2026, 0, 1)); // June 2026 starts on Monday
    expect(cells[0].key).toBe("2026-06-01");
    expect(cells[0].inMonth).toBe(true);
  });
});

describe("currentWeekCells", () => {
  it("returns the Monday–Sunday row that contains today", () => {
    // 13 October 2026 is a Tuesday → that week is 12–18 October.
    const week = currentWeekCells(new Date(2026, 9, 13, 15, 0));
    expect(week).toHaveLength(7);
    expect(week[0].key).toBe("2026-10-12");
    expect(week[6].key).toBe("2026-10-18");
    expect(week.filter((cell) => cell.isToday).map((cell) => cell.key)).toEqual(["2026-10-13"]);
  });
});

describe("miniMonthRange", () => {
  it("covers every cell up to the end of the last one", () => {
    const cells = buildMiniMonth(2026, 9, new Date(2026, 9, 13));
    const range = miniMonthRange(cells);
    expect(new Date(range.from).getTime()).toBe(new Date(2026, 8, 28).getTime());
    expect(new Date(range.to).getTime()).toBe(new Date(2026, 10, 9).getTime());
  });
});

describe("markDays", () => {
  it("counts events by start day and only OPEN tasks by due day", () => {
    const at = (d: number, h = 10): string => new Date(2026, 9, d, h).toISOString();
    const marks = markDays(
      [{ startAt: at(13) }, { startAt: at(13, 18) }, { startAt: "garbage" }],
      [
        { dueAt: at(13), closed: false },
        { dueAt: at(14), closed: true },
        { dueAt: null, closed: false }
      ]
    );
    expect(marks.get(localDayKey(new Date(2026, 9, 13)))).toEqual({ events: 2, tasks: 1 });
    expect(marks.has(localDayKey(new Date(2026, 9, 14)))).toBe(false);
  });
});
