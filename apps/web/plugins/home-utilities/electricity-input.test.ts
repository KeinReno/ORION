import { describe, expect, it } from "vitest";
import { canRecordReading, parseDecimalInput, parseRateInput, parseRubToMinor, parseWholeInput } from "./electricity-input";

describe("electricity input", () => {
  it("accepts plain decimals with comma, spaces and rejects number-literal tricks", () => {
    expect(parseDecimalInput("1 250,5")).toBe(1250.5);
    for (const bad of ["", "0x10", "1e3", "Infinity", "-5", "1,2,3", "abc"]) expect(parseDecimalInput(bad)).toBeNaN();
  });
  it("parses whole days strictly", () => {
    expect(parseWholeInput(" 12 ")).toBe(12);
    for (const bad of ["12.5", "1e1", "", "-1"]) expect(parseWholeInput(bad)).toBeNaN();
  });
  it("parses rubles to kopecks", () => {
    expect(parseRubToMinor("687,50")).toBe(68750);
    expect(parseRubToMinor("1.15")).toBe(115);
    expect(parseRubToMinor("1.155")).toBeNull();
  });
  it("tells an invalid typed tariff from an empty one", () => {
    expect(parseRateInput("")).toEqual({ kind: "empty" });
    expect(parseRateInput("6,25")).toEqual({ kind: "ok", rateRub: "6.25" });
    expect(parseRateInput("0")).toEqual({ kind: "invalid" });
    expect(parseRateInput("шесть")).toEqual({ kind: "invalid" });
  });
  it("lets a reading be recorded without any tariff", () => {
    expect(canRecordReading(100, "100")).toBe(true);
    expect(canRecordReading(100, "99,9")).toBe(false);
    expect(canRecordReading(null, "5")).toBe(false);
    expect(canRecordReading(100, "")).toBe(false);
  });
});
