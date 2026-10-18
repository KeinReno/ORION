import { describe, expect, it } from "vitest";
import { layoutAllDay, layoutDay } from "./time-grid";

const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const utcDate = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 12 + i)); // Mon 12 – Sun 18 Oct 2026

describe("layoutDay", () => {
  it("splits an overnight event across both days with its real length", () => {
    const flight = { id: "f", label: "Перелёт", start: local(14, 22), end: local(15, 2) };
    const [first] = layoutDay(new Date(2026, 9, 14), [flight]);
    expect(first).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60, continued: false, continues: true });
    const [second] = layoutDay(new Date(2026, 9, 15), [flight]);
    expect(second).toMatchObject({ startMin: 0, endMin: 2 * 60, continued: true, continues: false });
    expect(layoutDay(new Date(2026, 9, 16), [flight])).toHaveLength(0);
  });

  it("keeps an event ending exactly at midnight on its own day only", () => {
    const late = { id: "l", label: "Поздно", start: local(14, 23), end: local(15, 0) };
    expect(layoutDay(new Date(2026, 9, 14), [late])[0]).toMatchObject({ startMin: 23 * 60, endMin: 24 * 60, continues: false });
    expect(layoutDay(new Date(2026, 9, 15), [late])).toHaveLength(0);
  });

  it("puts overlapping events side by side", () => {
    const parts = layoutDay(new Date(2026, 9, 14), [
      { id: "a", label: "A", start: local(14, 10), end: local(14, 11, 30) },
      { id: "b", label: "B", start: local(14, 10, 30), end: local(14, 12) },
      { id: "c", label: "C", start: local(14, 11), end: local(14, 11, 45) }
    ]);
    expect(parts.map((p) => [p.item.id, p.lane, p.lanes])).toEqual([["a", 0, 3], ["b", 1, 3], ["c", 2, 3]]);
  });

  it("leaves all-day items to the all-day row", () => {
    expect(layoutDay(new Date(2026, 9, 14), [{ id: "d", label: "День", start: utcDate(14), end: utcDate(15), allDay: true }])).toHaveLength(0);
  });
});

describe("layoutAllDay", () => {
  it("draws a multi-day item as one bar and treats the end as exclusive", () => {
    const { bars } = layoutAllDay(week, [{ id: "v", label: "Отпуск", start: utcDate(12), end: utcDate(15), allDay: true }]);
    expect(bars).toEqual([expect.objectContaining({ from: 0, to: 2, lane: 0 })]);
  });

  it("clips bars to the visible days and stacks overlapping ones", () => {
    const { bars, lanes } = layoutAllDay(week, [
      { id: "long", label: "Командировка", start: utcDate(10), end: utcDate(14), allDay: true },
      { id: "one", label: "Праздник", start: utcDate(13), end: utcDate(14), allDay: true },
      { id: "late", label: "Отпуск", start: utcDate(17), end: utcDate(25), allDay: true }
    ]);
    expect(bars.map((b) => [b.item.id, b.from, b.to, b.lane])).toEqual([["long", 0, 1, 0], ["one", 1, 1, 1], ["late", 5, 6, 0]]);
    expect(lanes).toBe(2);
  });
});
