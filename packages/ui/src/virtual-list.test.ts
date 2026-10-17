import { describe, expect, it } from "vitest";
import { visibleRange } from "./virtual-list";

describe("visibleRange", () => {
  it("draws the first rows plus overscan at the top", () => {
    expect(visibleRange(0, 200, 40, 1000, 2)).toEqual({ start: 0, end: 7 });
  });
  it("follows the scroll position and never runs past the end", () => {
    expect(visibleRange(4000, 200, 40, 1000, 2)).toEqual({ start: 98, end: 107 });
    expect(visibleRange(39_900, 200, 40, 1000, 2).end).toBe(1000);
  });
  it("handles an empty list and a bad row height", () => {
    expect(visibleRange(0, 200, 40, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 200, 0, 10)).toEqual({ start: 0, end: 0 });
  });
});
