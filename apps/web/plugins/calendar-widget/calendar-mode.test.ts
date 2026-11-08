import { describe, expect, it } from "vitest";
import { calendarCapPx, parseSavedCalendarMode, pickCalendarMode } from "./calendar-mode";

describe("pickCalendarMode", () => {
  it("uses the container height when nothing is saved", () => {
    expect(pickCalendarMode(239, null)).toBe("week");
    expect(pickCalendarMode(240, null)).toBe("full");
    expect(pickCalendarMode(119, null)).toBe("minimal");
    expect(pickCalendarMode(120, null)).toBe("week");
    expect(pickCalendarMode(0, null)).toBe("minimal");
    expect(pickCalendarMode(-20, null)).toBe("minimal");
  });

  it("lets a saved preference force a smaller mode only", () => {
    expect(pickCalendarMode(480, "minimal")).toBe("minimal");
    expect(pickCalendarMode(480, "week")).toBe("week");
    expect(pickCalendarMode(480, "full")).toBe("full");
    expect(pickCalendarMode(180, "full")).toBe("week");
    expect(pickCalendarMode(80, "week")).toBe("minimal");
    expect(pickCalendarMode(80, "full")).toBe("minimal");
    expect(pickCalendarMode(80, null)).toBe("minimal");
  });
});

describe("calendarCapPx", () => {
  it("is about 30% of the sidebar and never negative", () => {
    expect(calendarCapPx(1000)).toBe(300);
    expect(calendarCapPx(0)).toBe(0);
    expect(calendarCapPx(-10)).toBe(0);
  });
});

describe("parseSavedCalendarMode", () => {
  it("keeps a mode and maps the old collapsed flag to minimal", () => {
    expect(parseSavedCalendarMode("week", "1")).toBe("week");
    expect(parseSavedCalendarMode(null, "1")).toBe("minimal");
    expect(parseSavedCalendarMode(null, "0")).toBeNull();
    expect(parseSavedCalendarMode("nope", null)).toBeNull();
  });
});
