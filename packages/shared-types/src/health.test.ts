import { describe, expect, it } from "vitest";
import {
  addMonthsToDay,
  createHealthPreventiveInputSchema,
  createHealthSubjectInputSchema,
  healthCanWrite,
  preventiveNextDue,
  preventiveStatus
} from "./health";

describe("addMonthsToDay", () => {
  it("не переполняет конец месяца", () => {
    expect(addMonthsToDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDay("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("переходит через год", () => {
    expect(addMonthsToDay("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsToDay("2026-10-15", 12)).toBe("2027-10-15");
  });
});

describe("preventiveNextDue", () => {
  it("срок от последнего раза плюс период", () => {
    expect(preventiveNextDue({ everyMonths: 6, firstDueAt: "2020-01-01", lastDoneAt: "2026-04-10" })).toBe("2026-10-10");
  });
  it("ни разу не делали — первый срок", () => {
    expect(preventiveNextDue({ everyMonths: 12, firstDueAt: "2026-12-01", lastDoneAt: null })).toBe("2026-12-01");
  });
  it("разовая вещь, уже сделанная, срока не имеет", () => {
    expect(preventiveNextDue({ everyMonths: null, firstDueAt: "2020-01-01", lastDoneAt: "2026-04-10" })).toBeNull();
  });
  it("без данных — null", () => {
    expect(preventiveNextDue({ everyMonths: null, firstDueAt: null, lastDoneAt: null })).toBeNull();
  });
});

describe("preventiveStatus", () => {
  it("просрочено, скоро, нормально и без срока; граница 30 дней включительно", () => {
    expect(preventiveStatus("2026-10-14", "2026-10-15")).toBe("overdue");
    expect(preventiveStatus("2026-10-15", "2026-10-15")).toBe("soon");
    expect(preventiveStatus("2026-11-14", "2026-10-15")).toBe("soon");
    expect(preventiveStatus("2026-11-15", "2026-10-15")).toBe("ok");
    expect(preventiveStatus(null, "2026-10-15")).toBe("unscheduled");
  });
});

describe("входные схемы", () => {
  it("человек: дата только в формате дня, дефолты пустые", () => {
    expect(createHealthSubjectInputSchema.parse({ kind: "dependent", name: " Маша " })).toMatchObject({ name: "Маша", allergies: [], birthDate: null });
    expect(createHealthSubjectInputSchema.safeParse({ kind: "member", name: "Я", birthDate: "15.10.2026" }).success).toBe(false);
  });
  it("профилактика: период положительный", () => {
    expect(createHealthPreventiveInputSchema.safeParse({ name: "Стоматолог", everyMonths: 0 }).success).toBe(false);
    expect(createHealthPreventiveInputSchema.parse({ name: "Стоматолог", everyMonths: 6 }).kind).toBe("checkup");
  });
});

describe("healthCanWrite", () => {
  it("только просмотр не пишет", () => {
    expect(healthCanWrite("read")).toBe(false);
    expect(healthCanWrite("write")).toBe(true);
    expect(healthCanWrite("own")).toBe(true);
  });
});
