import { describe, expect, it } from "vitest";
import { electricityEstimate, electricityForecast, electricityTariffFromAmount, utilityTotals } from "./home-utilities";

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

describe("electricity tariff from a bill", () => {
  it("divides the amount by the consumption and keeps four decimals", () => {
    expect(electricityTariffFromAmount(1000, 1100, 62_500)).toBe("6.2500");
    expect(electricityTariffFromAmount(0, 3, 1_000)).toBe("3.3333");
    expect(electricityTariffFromAmount(100, 100.5, 313)).toBe("6.2600");
  });
  it("rejects equal or backwards readings and a non-positive amount", () => {
    expect(electricityTariffFromAmount(100, 100, 5_000)).toBeNull();
    expect(electricityTariffFromAmount(100, 90, 5_000)).toBeNull();
    expect(electricityTariffFromAmount(100, 110, 0)).toBeNull();
  });
  it("round-trips with the estimate", () => {
    const rate = electricityTariffFromAmount(1250, 1360, 71_875)!;
    expect(electricityEstimate(1250, 1360, rate)?.amountMinor).toBe(71_875);
  });
});

describe("electricity forecast to the end of the period", () => {
  it("scales the pace so far to the whole period and prices it", () => {
    expect(electricityForecast(1000, 1060, 10, 30, "6.0000")).toEqual({ consumed: 60, projected: 180, projectedEndReading: 1180, projectedAmountMinor: 108_000 });
  });
  it("works without a tariff and rejects impossible input", () => {
    expect(electricityForecast(1000, 1030, 15, 30)).toMatchObject({ projected: 60, projectedAmountMinor: null });
    expect(electricityForecast(1000, 990, 10, 30)).toBeNull();
    expect(electricityForecast(1000, 1010, 0, 30)).toBeNull();
    expect(electricityForecast(1000, 1010, 31, 30)).toBeNull();
  });
});
