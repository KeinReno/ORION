import { describe, expect, it } from "vitest";
import {
  advanceTaskRecurrence,
  bulkTaskRequestSchema,
  createTaskFieldInputSchema,
  describeTaskRecurrence,
  taskRecurrenceEndReached,
  validateTaskFieldValue
} from "./task-planning";

const day = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

describe("advanceTaskRecurrence", () => {
  it("daily adds the interval in days and keeps the clock time", () => {
    const next = advanceTaskRecurrence(day("2026-01-05"), { freq: "daily", interval: 3, weekdays: [] }, day("2026-01-05"));
    expect(next.toISOString()).toBe("2026-01-08T09:00:00.000Z");
  });

  it("weekdays skips Saturday and Sunday", () => {
    // 2026-01-09 is a Friday.
    const next = advanceTaskRecurrence(day("2026-01-09"), { freq: "weekdays", interval: 1, weekdays: [] }, day("2026-01-09"));
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.toISOString()).toBe("2026-01-12T09:00:00.000Z");
  });

  it("weekly honours an explicit weekday list and the interval grid from the anchor", () => {
    // Anchor Monday 2026-01-05; every second week on Tuesday and Thursday.
    const anchor = day("2026-01-05");
    const first = advanceTaskRecurrence(anchor, { freq: "weekly", interval: 2, weekdays: [1, 3] }, anchor);
    expect(first.toISOString()).toBe("2026-01-06T09:00:00.000Z"); // Tuesday of the same week
    const second = advanceTaskRecurrence(first, { freq: "weekly", interval: 2, weekdays: [1, 3] }, anchor);
    expect(second.toISOString()).toBe("2026-01-08T09:00:00.000Z"); // Thursday of the same week
    const third = advanceTaskRecurrence(second, { freq: "weekly", interval: 2, weekdays: [1, 3] }, anchor);
    expect(third.toISOString()).toBe("2026-01-20T09:00:00.000Z"); // Tuesday two weeks later
  });

  it("monthly clamps 31 January to the end of February", () => {
    const next = advanceTaskRecurrence(day("2026-01-31"), { freq: "monthly", interval: 1, weekdays: [] }, day("2026-01-31"));
    expect(next.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });
});

describe("taskRecurrenceEndReached", () => {
  it("stops after the requested number of instances", () => {
    expect(taskRecurrenceEndReached({ mode: "count", count: 3 }, 2, day("2026-01-10"))).toBe(false);
    expect(taskRecurrenceEndReached({ mode: "count", count: 3 }, 3, day("2026-01-10"))).toBe(true);
  });

  it("stops past the until date and never stops otherwise", () => {
    expect(taskRecurrenceEndReached({ mode: "until", until: "2026-01-10T00:00:00.000Z" }, 1, day("2026-01-11"))).toBe(true);
    expect(taskRecurrenceEndReached({ mode: "until", until: "2026-01-10T00:00:00.000Z" }, 1, day("2026-01-09"))).toBe(false);
    expect(taskRecurrenceEndReached({ mode: "never" }, 500, day("2030-01-01"))).toBe(false);
  });
});

describe("describeTaskRecurrence", () => {
  it("summarises count and weekdays", () => {
    expect(describeTaskRecurrence({ freq: "weekly", interval: 2, weekdays: [1, 3], ends: { mode: "count", count: 4 } })).toBe("каждые 2 нед. по вт, чт, 4 раз");
    expect(describeTaskRecurrence({ freq: "weekdays", interval: 1, weekdays: [], ends: { mode: "never" } })).toBe("по будням");
  });
});

describe("validateTaskFieldValue", () => {
  const field = (type: Parameters<typeof validateTaskFieldValue>[0]["type"], options: string[] = []) => ({ type, options, name: "Поле" });

  it("accepts and normalises each supported type", () => {
    expect(validateTaskFieldValue(field("number"), "12")).toEqual({ ok: true, value: 12, text: "12" });
    expect(validateTaskFieldValue(field("checkbox"), true)).toEqual({ ok: true, value: true, text: "да" });
    expect(validateTaskFieldValue(field("multi", ["a", "b"]), ["b", "a", "b"])).toEqual({ ok: true, value: ["b", "a"], text: "b a" });
    expect(validateTaskFieldValue(field("url"), "https://example.com")).toEqual({ ok: true, value: "https://example.com", text: "https://example.com" });
  });

  it("treats empty values as absent", () => {
    expect(validateTaskFieldValue(field("text"), "")).toEqual({ ok: true, value: null, text: null });
    expect(validateTaskFieldValue(field("multi", ["a"]), [])).toEqual({ ok: true, value: null, text: null });
  });

  it("rejects values outside the declared type or options", () => {
    expect(validateTaskFieldValue(field("select", ["a"]), "c").ok).toBe(false);
    expect(validateTaskFieldValue(field("number"), "abc").ok).toBe(false);
    expect(validateTaskFieldValue(field("date"), "tomorrow").ok).toBe(false);
    expect(validateTaskFieldValue(field("checkbox"), "yes").ok).toBe(false);
  });
});

describe("bulkTaskRequestSchema", () => {
  it("defaults to a non-applying request and caps the batch size", () => {
    const parsed = bulkTaskRequestSchema.parse({ taskIds: ["a"], operation: { type: "complete" } });
    expect(parsed.dryRun).toBe(false);
    expect(parsed.confirm).toBe(false);
    expect(parsed.allowPartial).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, index) => `t${index}`);
    expect(bulkTaskRequestSchema.safeParse({ taskIds: tooMany, operation: { type: "complete" } }).success).toBe(false);
  });
});

describe("createTaskFieldInputSchema", () => {
  it("requires options for select fields and a project for project-scoped fields", () => {
    expect(createTaskFieldInputSchema.safeParse({ name: "Метка", type: "select" }).success).toBe(false);
    expect(createTaskFieldInputSchema.safeParse({ name: "Метка", type: "text", applicability: "project" }).success).toBe(false);
    expect(createTaskFieldInputSchema.safeParse({ name: "Метка", type: "select", options: ["A"] }).success).toBe(true);
  });
});
