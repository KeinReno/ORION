import type { PetCareDayLog, PetCarePet } from "@orion/shared-types";
import { describe, expect, it } from "vitest";
import { parseDecimalInput, petAgeLabel, petLocalDayKey, petMonthGrid, shiftPetMonth } from "./pet-care-days";
import { petDaysToCsv, petReportHtml, petSymptomsToCsv } from "./pet-care-report";

const day = (patch: Partial<PetCareDayLog> = {}): PetCareDayLog => ({
  id: "d1",
  workspaceId: "w",
  petId: "p",
  day: "2026-10-18",
  status: "bad",
  statusAuto: true,
  appetite: "reduced",
  activity: "",
  stool: "liquid",
  stoolVisits: [],
  water: "",
  vomitingCount: 2,
  weightKg: 4.4,
  temperature: null,
  meds: "церукал; утром",
  note: 'сказал "ой" <b>',
  symptoms: [{ id: "vomiting", severity: "moderate", count: 2, time: "night", note: "", amount: "normal" }],
  createdAt: "2026-10-18T10:00:00.000Z",
  updatedAt: "2026-10-18T10:00:00.000Z",
  ...patch
});

describe("petLocalDayKey", () => {
  it("uses the local calendar day, not UTC", () => {
    expect(petLocalDayKey(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(petLocalDayKey(new Date(2026, 0, 1, 0, 1))).toBe("2026-01-01");
  });
});

describe("petMonthGrid", () => {
  it("starts on Monday and always has 42 cells covering the month", () => {
    const grid = petMonthGrid(2026, 10); // 1 октября 2026 — четверг
    expect(grid).toHaveLength(42);
    expect(grid[0]).toMatchObject({ day: "2026-09-28", inMonth: false });
    expect(grid[3]).toMatchObject({ day: "2026-10-01", dayOfMonth: 1, inMonth: true });
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("handles a month that starts on Monday", () => {
    const grid = petMonthGrid(2026, 6); // 1 июня 2026 — понедельник
    expect(grid[0]).toMatchObject({ day: "2026-06-01", inMonth: true });
  });
});

describe("shiftPetMonth", () => {
  it("rolls over year boundaries", () => {
    expect(shiftPetMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftPetMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("petAgeLabel", () => {
  it("counts whole months and handles missing/future birthdays", () => {
    expect(petAgeLabel("2020-05-17", "2026-10-19")).toBe("6 лет 5 мес");
    expect(petAgeLabel("2026-10-01", "2026-10-19")).toBe("меньше месяца");
    expect(petAgeLabel("2020-10-20", "2026-10-19")).toBe("5 лет 11 мес");
    expect(petAgeLabel(null)).toBe("");
    expect(petAgeLabel("2030-01-01", "2026-10-19")).toBe("");
  });
});

describe("parseDecimalInput", () => {
  it("accepts comma decimals and rejects garbage instead of storing zero", () => {
    expect(parseDecimalInput("4,5")).toBe(4.5);
    expect(parseDecimalInput(" 38.6 ")).toBe(38.6);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
  });
});

describe("pet report", () => {
  it("writes CSV with BOM and quotes cells that contain separators or quotes", () => {
    const text = petDaysToCsv([day()]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = text.slice(1).split("\r\n");
    expect(header!.split(";")[0]).toBe("Дата");
    expect(row).toContain('"церукал; утром"');
    expect(row).toContain('"сказал ""ой"" <b>"');
    expect(row).toContain("Рвота ×2");
    expect(petSymptomsToCsv([day()]).slice(1).split("\r\n")[1]).toBe("2026-10-18;Рвота;Умеренно;2;Ночь;");
  });

  it("escapes user text in the printable HTML report", () => {
    const pet = { id: "p", workspaceId: "w", name: "<Мурчик>", species: "cat", birthday: null, notes: "", breed: "", vetContact: "", chronic: "", allergies: "", createdAt: "", updatedAt: "" } as PetCarePet;
    const html = petReportHtml(pet, [day()], "2026-10-01", "2026-10-19", "сейчас");
    expect(html).toContain("&lt;Мурчик&gt;");
    expect(html).not.toContain("<b>\"");
    expect(html).toContain("сказал &quot;ой&quot; &lt;b&gt;");
    expect(html).toContain("Это субъективные наблюдения владельца, не медицинский диагноз.");
  });
});
