import { describe, expect, it } from "vitest";
import { electricityEstimate, utilityTotals } from "./home-utilities";

describe("home utilities totals", () => {
  it("keeps draft bills separate from confirmed charges", () => {
    expect(utilityTotals({ rentMinor: 1_800_000, rentConfirmed: true, charges: [
      { id: "a", name: "Вода", amountMinor: 65_890, confirmed: true, note: "" },
      { id: "b", name: "Свет", amountMinor: 112_341, confirmed: false, note: "" }
    ] })).toEqual({ utilityMinor: 178_231, confirmedUtilityMinor: 65_890, grandTotalMinor: 1_978_231, confirmedTotalMinor: 1_865_890 });
  });
});

describe("electricity estimate", () => {
  it("rounds consumption and final kopecks once", () => {
    expect(electricityEstimate(100, 112.5, "6.2500")).toEqual({ consumption: 12.5, amountMinor: 7813 });
    expect(electricityEstimate(0, 0.001, "1.0000")).toEqual({ consumption: 0.001, amountMinor: 0 });
  });
  it("rejects backwards or invalid readings and tariffs", () => {
    expect(electricityEstimate(100, 99, "6.25")).toBeNull();
    expect(electricityEstimate(100, 101, "0")).toBeNull();
    expect(electricityEstimate(100, Number.NaN, "6.25")).toBeNull();
  });
});
