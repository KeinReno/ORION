import { describe, expect, it } from "vitest";
import { parseUtilityTable } from "./table-import";

describe("utility table import", () => {
  it("reads Google Sheets rows with Russian periods and preserves source totals", () => {
    const rows = parseUtilityTable("Период\tТулаводоканал\tТНС энерго\tИтого\tКВп\tИтоговая\nСентябрь 2024\t658,9\t526,24\t1185,14\t17000\t18185,14");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2024-09", rentMinor: 1700000, importedUtilityMinor: 118514, importedGrandTotalMinor: 1818514 });
    expect(rows[0].charges.map((item) => item.amountMinor)).toEqual([65890, 52624]);
    expect(rows[0].charges.every((item) => !item.confirmed)).toBe(true);
  });

  it("reads semicolon CSV and rejects duplicate months or broken amounts", () => {
    expect(parseUtilityTable("Период;Газпром;КВп\n2026-08;259,14;18000")[0].charges[0].amountMinor).toBe(25914);
    expect(() => parseUtilityTable("Период\tГазпром\tКВп\nМай 2026\t259\t18000\nМай 2026\t259\t18000")).toThrow("повторяются месяцы");
    expect(() => parseUtilityTable("Период\tГазпром\tКВп\nМай 2026\t25x\t18000")).toThrow("Строка 2");
  });
});
