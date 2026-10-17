import { describe, expect, it } from "vitest";
import {
  createHealthMeasurementInputSchema,
  formatMeasurement,
  measurementProblem,
  measurementsToCsv,
  rangeState,
  summarizeSeries,
  type HealthMeasurement
} from "./health-measurements";

const m = (value: number, day: number, extra: Partial<HealthMeasurement> = {}): HealthMeasurement => ({
  id: `m${day}`, subjectId: "s", kind: "weight", value, value2: null, measuredAt: new Date(Date.UTC(2026, 9, day, 8)).toISOString(), context: "", note: "", createdAt: "", ...extra
});

describe("измерения: защита от опечаток", () => {
  it("отвергает невозможные значения и принимает обычные", () => {
    expect(measurementProblem("weight", 700, null)).toMatch(/вне возможного/);
    expect(measurementProblem("weight", 72.5, null)).toBeNull();
    expect(measurementProblem("temperature", 36.6, null)).toBeNull();
    expect(measurementProblem("temperature", 3.6, null)).toMatch(/вне возможного/);
  });
  it("давление: нужно нижнее и оно меньше верхнего", () => {
    expect(measurementProblem("blood_pressure", 120, null)).toMatch(/нижнее/i);
    expect(measurementProblem("blood_pressure", 120, 130)).toMatch(/меньше верхнего/);
    expect(measurementProblem("blood_pressure", 120, 80)).toBeNull();
    expect(measurementProblem("pulse", 70, 80)).toMatch(/не используется/);
  });
  it("схема ввода применяет те же правила", () => {
    expect(createHealthMeasurementInputSchema.safeParse({ kind: "weight", value: 70 }).success).toBe(true);
    expect(createHealthMeasurementInputSchema.safeParse({ kind: "weight", value: 7000 }).success).toBe(false);
  });
});

describe("личный диапазон", () => {
  it("выше, ниже, в пределах, не задан; граница включительна", () => {
    const t = { min: 60, max: 80 };
    expect([50, 60, 70, 80, 90].map((v) => rangeState(v, t))).toEqual(["below", "within", "within", "within", "above"]);
    expect(rangeState(70, null)).toBe("unset");
    expect(rangeState(70, { min: null, max: null })).toBe("unset");
    expect(rangeState(90, { min: null, max: 80 })).toBe("above");
  });
});

describe("сводка ряда", () => {
  it("последнее, min/max/среднее, изменение, вне диапазона", () => {
    const s = summarizeSeries([m(72, 3), m(70, 1), m(75, 5)], { min: null, max: 74 });
    expect(s).toMatchObject({ count: 3, min: 70, max: 75, average: 72.33, change: 5, outOfRange: 1 });
    expect(s.latest?.value).toBe(75);
  });
  it("пустой ряд и одна точка не ломаются", () => {
    expect(summarizeSeries([], null)).toMatchObject({ count: 0, latest: null, change: null });
    expect(summarizeSeries([m(70, 1)], null).change).toBeNull();
  });
});

describe("форматирование и CSV", () => {
  it("давление через дробь, вес с запятой", () => {
    expect(formatMeasurement({ kind: "blood_pressure", value: 120, value2: 80 })).toBe("120/80");
    expect(formatMeasurement({ kind: "weight", value: 72.4, value2: null })).toBe("72,4");
  });
  it("CSV отсортирован по времени, поля с ; и кавычками экранированы", () => {
    const csv = measurementsToCsv([m(71, 2, { context: "натощак; утром", note: 'сказал "ок"' }), m(70, 1)]).split("\n");
    expect(csv[0]).toBe("Дата;Показатель;Значение;Единица;Условия;Заметка");
    expect(csv[1]).toContain("70,0;кг");
    expect(csv[2]).toContain('"натощак; утром";"сказал ""ок"""');
  });
});
