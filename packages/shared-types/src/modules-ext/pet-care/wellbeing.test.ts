import { describe, expect, it } from "vitest";
import {
  addPetDays,
  computePetAlerts,
  computePetDayStatus,
  computePetStats,
  diffPetDays,
  importMurhpInputSchema,
  parseMurhpBackup,
  petCareRangeQuerySchema,
  upsertPetCareDayInputSchema,
  type PetDayRecord
} from "./wellbeing";

const facts = { appetite: "", activity: "", stool: "", water: "", vomitingCount: 0, symptoms: [] } as const;
const record = (day: string, patch: Partial<PetDayRecord> = {}): PetDayRecord => ({
  ...facts,
  day,
  status: "normal",
  statusAuto: true,
  weightKg: null,
  ...patch
});

describe("pet day arithmetic", () => {
  it("shifts calendar days across month, year and leap boundaries without time zones", () => {
    expect(addPetDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addPetDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addPetDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffPetDays("2026-10-19", "2026-10-09")).toBe(10);
    expect(diffPetDays("2026-03-30", "2026-03-28")).toBe(2); // сутки перехода на летнее время не искажают счёт
  });
});

describe("computePetDayStatus", () => {
  it("is good when everything is fine or unrecorded", () => {
    expect(computePetDayStatus({ ...facts, appetite: "normal", activity: "normal", stool: "normal", water: "normal" })).toBe("good");
    expect(computePetDayStatus(facts)).toBe("good");
  });

  it("treats 'no stool today' as nothing wrong", () => {
    expect(computePetDayStatus({ ...facts, stool: "none" })).toBe("good");
  });

  it("escalates by signals", () => {
    expect(computePetDayStatus({ ...facts, vomitingCount: 1 })).toBe("watch");
    expect(computePetDayStatus({ ...facts, stool: "soft" })).toBe("watch");
    expect(computePetDayStatus({ ...facts, symptoms: [{ id: "sneezing", severity: "mild" }] })).toBe("watch");
    expect(computePetDayStatus({ ...facts, vomitingCount: 2 })).toBe("bad");
    expect(computePetDayStatus({ ...facts, stool: "liquid" })).toBe("bad");
    expect(computePetDayStatus({ ...facts, symptoms: [{ id: "coughing", severity: "moderate" }, { id: "sneezing", severity: "moderate" }] })).toBe("bad");
    expect(computePetDayStatus({ ...facts, vomitingCount: 4 })).toBe("critical");
    expect(computePetDayStatus({ ...facts, stool: "blood" })).toBe("critical");
    expect(computePetDayStatus({ ...facts, water: "none" })).toBe("critical");
    expect(computePetDayStatus({ ...facts, appetite: "refused", activity: "very_low" })).toBe("critical");
    expect(computePetDayStatus({ ...facts, symptoms: [{ id: "breathing", severity: "mild" }] })).toBe("critical");
    expect(computePetDayStatus({ ...facts, symptoms: [{ id: "other", severity: "critical" }] })).toBe("critical");
  });
});

describe("computePetAlerts", () => {
  const today = "2026-10-19";

  it("raises a vomiting streak but tolerates a not-yet-logged today", () => {
    const days = [record("2026-10-18", { vomitingCount: 1 }), record("2026-10-17", { vomitingCount: 2 }), record("2026-10-16", { vomitingCount: 1 })];
    expect(computePetAlerts(days, today).map((a) => a.title)).toEqual(["Рвота 3 дня подряд"]);
  });

  it("is broken by a gap", () => {
    const days = [record("2026-10-18", { vomitingCount: 1 }), record("2026-10-16", { vomitingCount: 1 }), record("2026-10-15", { vomitingCount: 1 })];
    expect(computePetAlerts(days, today)).toEqual([]);
  });

  it("reports one-off critical signals once and a weight drop over 5%", () => {
    const days = [
      record("2026-10-19", { stool: "blood", symptoms: [{ id: "blood_stool", severity: "severe" }] }),
      record("2026-10-17", { stool: "blood" }),
      record("2026-10-01", { weightKg: 5 }),
      record("2026-10-15", { weightKg: 4.6 })
    ];
    const titles = computePetAlerts(days, today).map((a) => a.title);
    expect(titles.filter((t) => t === "Кровь в стуле")).toHaveLength(1);
    expect(titles).toContain("Снижение веса больше 5%");
  });
});

describe("computePetStats", () => {
  it("counts statuses, episodes, streaks and symptom frequency", () => {
    const days = [
      record("2026-10-10", { vomitingCount: 2, symptoms: [{ id: "vomiting", severity: "moderate" }], weightKg: 4.4 }),
      record("2026-10-11", { stool: "liquid", activity: "low", symptoms: [{ id: "vomiting", severity: "mild" }] }),
      record("2026-10-12", { appetite: "normal" }),
      record("2026-10-13", { status: "critical", statusAuto: false, weightKg: 4.2 })
    ];
    const stats = computePetStats(days, "2026-10-08", "2026-10-14");
    expect(stats.totalDays).toBe(7);
    expect(stats.loggedDays).toBe(4);
    expect(stats.byStatus).toEqual({ good: 1, normal: 0, watch: 0, bad: 2, critical: 1 });
    expect(stats.badOrWorse).toBe(3);
    expect(stats.vomitingEpisodes).toBe(2);
    expect(stats.vomitingDays).toBe(1);
    expect(stats.looseStoolDays).toBe(1);
    expect(stats.lethargyDays).toBe(1);
    expect(stats.longestBadStreak).toBe(2);
    expect(stats.weightFirst).toBe(4.4);
    expect(stats.weightLast).toBe(4.2);
    expect(stats.symptomFreq[0]).toEqual({ id: "vomiting", label: "Рвота", count: 2 });
  });
});

describe("day input schema", () => {
  it("applies defaults and rejects duplicate symptoms and impossible values", () => {
    const parsed = upsertPetCareDayInputSchema.parse({});
    expect(parsed).toMatchObject({ statusAuto: true, status: "normal", vomitingCount: 0, weightKg: null, symptoms: [] });
    expect(upsertPetCareDayInputSchema.safeParse({ symptoms: [{ id: "vomiting" }, { id: "vomiting" }] }).success).toBe(false);
    expect(upsertPetCareDayInputSchema.safeParse({ temperature: 12 }).success).toBe(false);
    expect(upsertPetCareDayInputSchema.safeParse({ appetite: "huge" }).success).toBe(false);
    expect(upsertPetCareDayInputSchema.parse({ symptoms: [{ id: "vomiting" }] }).symptoms[0]).toEqual({ id: "vomiting", severity: "moderate", count: 1, time: "", note: "" });
  });

  it("limits the requested window", () => {
    expect(petCareRangeQuerySchema.safeParse({ from: "2026-01-01", to: "2026-10-19" }).success).toBe(true);
    expect(petCareRangeQuerySchema.safeParse({ from: "2020-01-01", to: "2026-10-19" }).success).toBe(false);
    expect(petCareRangeQuerySchema.safeParse({ from: "2026-10-19", to: "2026-10-01" }).success).toBe(false);
    expect(petCareRangeQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe("parseMurhpBackup", () => {
  const backup = {
    app: "murhp",
    version: 1,
    exportedAt: "2026-10-19T10:00:00Z",
    cat: { name: "Мурчик", birthdate: "2020-05-17", breed: "Британец", weightKg: 5.1, vetContact: "+7 900", chronic: "", allergies: "курица", notes: "" },
    days: [
      { date: "2026-10-01", status: "bad", statusAuto: false, appetite: "reduced", activity: "weird", stool: "liquid", water: "normal", vomitingCount: 2, weightKg: 5, temperature: 38.6, meds: "церукал", note: "плохо", symptoms: [{ id: "vomiting", severity: "severe", count: 2, time: "night", note: "" }, { id: "vomiting" }, { id: "" }] },
      { date: "2026-02-31", status: "good" },
      "мусор",
      { date: "2026-10-02", vomitingCount: -4, weightKg: 9999 }
    ],
    events: [{ date: "2026-10-01", type: "food_change", title: "Новый корм", note: "" }, { date: "вчера", type: "note" }, { date: "2026-10-03", type: "alien", title: "x" }]
  };

  it("reads days and events leniently and counts unreadable rows", () => {
    const parsed = parseMurhpBackup(importMurhpInputSchema.parse({ backup }).backup);
    expect(parsed.invalidRows).toBe(3);
    expect(parsed.days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
    const first = parsed.days[0]!.input;
    expect(first).toMatchObject({ status: "bad", statusAuto: false, appetite: "reduced", activity: "", stool: "liquid", vomitingCount: 2, weightKg: 5, temperature: 38.6, meds: "церукал" });
    expect(first.symptoms).toEqual([{ id: "vomiting", severity: "severe", count: 2, time: "night", note: "" }]);
    expect(parsed.days[1]!.input).toMatchObject({ vomitingCount: 0, weightKg: null, statusAuto: true });
    expect(parsed.events).toEqual([
      { day: "2026-10-01", type: "food_change", title: "Новый корм", note: "" },
      { day: "2026-10-03", type: "note", title: "x", note: "" }
    ]);
    expect(parsed.profile).toMatchObject({ name: "Мурчик", birthdate: "2020-05-17", breed: "Британец", weightKg: 5.1, allergies: "курица" });
  });

  it("rejects a file that is not a MurHP backup", () => {
    expect(importMurhpInputSchema.safeParse({ backup: { app: "other", days: [] } }).success).toBe(false);
  });

  it("lets the last row win for a repeated date", () => {
    const parsed = parseMurhpBackup({ days: [{ date: "2026-10-01", note: "a" }, { date: "2026-10-01", note: "b" }], events: [] });
    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0]!.input.note).toBe("b");
  });
});
