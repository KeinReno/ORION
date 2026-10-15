import { describe, expect, it } from "vitest";
import { createHealthSymptomInputSchema, symptomMinutes, symptomOngoing } from "./health-symptoms";

describe("журнал симптомов", () => {
  it("сила от 0 до 10 целым числом", () => {
    expect(createHealthSymptomInputSchema.safeParse({ name: "Головная боль", severity: 11 }).success).toBe(false);
    expect(createHealthSymptomInputSchema.safeParse({ name: "Головная боль", severity: 3.5 }).success).toBe(false);
    expect(createHealthSymptomInputSchema.safeParse({ name: "Головная боль", severity: 0 }).success).toBe(true);
    expect(createHealthSymptomInputSchema.parse({ name: " Кашель ", severity: 4 })).toMatchObject({ name: "Кашель", endedAt: null, triggers: "" });
  });
  it("конец не раньше начала", () => {
    expect(createHealthSymptomInputSchema.safeParse({ name: "x", severity: 1, startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-09T10:00:00.000Z" }).success).toBe(false);
  });
  it("идёт, пока нет конца; длительность считается до «сейчас» и не бывает отрицательной", () => {
    const open = { startedAt: "2026-10-10T10:00:00.000Z", endedAt: null };
    expect(symptomOngoing(open)).toBe(true);
    expect(symptomMinutes(open, new Date("2026-10-10T12:30:00.000Z"))).toBe(150);
    expect(symptomMinutes({ startedAt: "2026-10-10T10:00:00.000Z", endedAt: "2026-10-10T10:45:00.000Z" })).toBe(45);
    expect(symptomMinutes(open, new Date("2026-10-09T00:00:00.000Z"))).toBe(0);
  });
});
