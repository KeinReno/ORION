import { describe, expect, it } from "vitest";
import {
  createHealthMedicationInputSchema,
  doseTiming,
  isLowStock,
  medicationAdherence,
  medicationScheduledOn,
  medicationSlots
} from "./health-medications";

const base = { asNeeded: false, times: ["20:00", "08:00"], weekdays: [], startOn: null, endOn: null };

describe("расписание", () => {
  it("слоты по возрастанию и без повторов", () => {
    expect(medicationSlots({ ...base, times: ["20:00", "08:00", "08:00"] }, "2026-10-15")).toEqual(["08:00", "20:00"]);
  });
  it("дни недели: пн=0, 15.10.2026 — четверг", () => {
    const mwf = { ...base, weekdays: [0, 2, 4] };
    expect(medicationScheduledOn(mwf, "2026-10-14")).toBe(true); // среда
    expect(medicationScheduledOn(mwf, "2026-10-15")).toBe(false); // четверг
  });
  it("курс ограничен началом и концом включительно", () => {
    const course = { ...base, startOn: "2026-10-10", endOn: "2026-10-12" };
    expect(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"].map((d) => medicationScheduledOn(course, d))).toEqual([false, true, true, false]);
  });
  it("«по требованию» и пустое расписание никогда не запланированы", () => {
    expect(medicationScheduledOn({ ...base, asNeeded: true }, "2026-10-15")).toBe(false);
    expect(medicationScheduledOn({ ...base, times: [] }, "2026-10-15")).toBe(false);
  });
});

describe("соблюдение схемы", () => {
  it("считает запланированное, принятое и пропущенное; чужие отметки не в счёт", () => {
    const med = { ...base, times: ["08:00"] };
    const out = medicationAdherence(
      med,
      [
        { day: "2026-10-10", time: "08:00", status: "taken" },
        { day: "2026-10-11", time: "08:00", status: "skipped" },
        { day: "2026-10-12", time: "09:30", status: "taken" } // не слот расписания
      ],
      "2026-10-10",
      "2026-10-13"
    );
    expect(out).toEqual({ planned: 4, taken: 1, skipped: 1 });
  });
  it("ничего не запланировано — нули, а не деление на ноль", () => {
    expect(medicationAdherence({ ...base, asNeeded: true }, [], "2026-10-01", "2026-10-30")).toEqual({ planned: 0, taken: 0, skipped: 0 });
  });
});

describe("остаток и время слота", () => {
  it("низкий остаток только если ведётся и порог задан", () => {
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
    expect(isLowStock(null, 5)).toBe(false);
    expect(isLowStock(3, null)).toBe(false);
  });
  it("слот прошёл или впереди по локальному времени", () => {
    expect(doseTiming({ day: "2026-10-15", time: "08:00" }, "2026-10-15", "09:00")).toBe("past");
    expect(doseTiming({ day: "2026-10-15", time: "20:00" }, "2026-10-15", "09:00")).toBe("upcoming");
    expect(doseTiming({ day: "2026-10-14", time: "23:59" }, "2026-10-15", "00:00")).toBe("past");
  });
});

describe("входная схема", () => {
  it("нужен либо график, либо «по требованию»", () => {
    expect(createHealthMedicationInputSchema.safeParse({ name: "Х" }).success).toBe(false);
    expect(createHealthMedicationInputSchema.safeParse({ name: "Х", asNeeded: true }).success).toBe(true);
    expect(createHealthMedicationInputSchema.safeParse({ name: "Х", times: ["8:00"] }).success).toBe(false);
    expect(createHealthMedicationInputSchema.parse({ name: " Х ", times: ["08:00"] }).dose).toBe("");
  });
  it("конец курса не раньше начала", () => {
    expect(createHealthMedicationInputSchema.safeParse({ name: "Х", times: ["08:00"], startOn: "2026-10-10", endOn: "2026-10-01" }).success).toBe(false);
  });
});
