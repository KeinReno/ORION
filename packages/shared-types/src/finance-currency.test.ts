import { describe, expect, it } from "vitest";
import { createBudgetInputSchema, financeRowCurrencies, pickFinanceCurrency, primaryAccountCurrency } from "./finance";

describe("primaryAccountCurrency", () => {
  it("is RUB without accounts", () => {
    expect(primaryAccountCurrency([])).toBe("RUB");
  });

  it("is the only currency of a single-currency workspace", () => {
    expect(primaryAccountCurrency([{ currency: "USD" }, { currency: "USD", archivedAt: null }])).toBe("USD");
  });

  it("is the currency most live accounts are in, ignoring archived ones", () => {
    const accounts = [
      { currency: "USD", archivedAt: null },
      { currency: "RUB", archivedAt: null },
      { currency: "RUB", archivedAt: null },
      { currency: "USD", archivedAt: "2026-01-01T00:00:00.000Z" },
      { currency: "USD", archivedAt: new Date() }
    ];
    expect(primaryAccountCurrency(accounts)).toBe("RUB");
  });

  it("breaks a tie alphabetically, whatever the row order", () => {
    expect(primaryAccountCurrency([{ currency: "USD" }, { currency: "EUR" }])).toBe("EUR");
    expect(primaryAccountCurrency([{ currency: "EUR" }, { currency: "USD" }])).toBe("EUR");
  });

  it("falls back to archived accounts when nothing is live", () => {
    expect(primaryAccountCurrency([{ currency: "USD", archivedAt: "2026-01-01T00:00:00.000Z" }])).toBe("USD");
  });
});

describe("pickFinanceCurrency", () => {
  it("keeps the person's pick while it is available", () => {
    expect(pickFinanceCurrency(["RUB", "USD"], "USD", "RUB")).toBe("USD");
  });

  it("falls back to the preferred currency, then to the first row", () => {
    expect(pickFinanceCurrency(["RUB", "USD"], "EUR", "USD")).toBe("USD");
    expect(pickFinanceCurrency(["RUB", "USD"], null, "EUR")).toBe("RUB");
    expect(pickFinanceCurrency([], null, "RUB")).toBeNull();
  });
});

describe("financeRowCurrencies", () => {
  it("lists each currency once, in row order", () => {
    expect(financeRowCurrencies([{ currency: "RUB" }, { currency: "RUB" }, { currency: "USD" }])).toEqual(["RUB", "USD"]);
  });
});

describe("createBudgetInputSchema", () => {
  it("leaves the currency to the server when it is not given", () => {
    const parsed = createBudgetInputSchema.parse({ categoryId: "c", month: "2026-10-01T00:00:00.000Z", limitAmount: 100 });
    expect(parsed.currency).toBeUndefined();
  });

  it("rejects a currency code that is not three letters", () => {
    expect(createBudgetInputSchema.safeParse({ categoryId: "c", month: "2026-10-01T00:00:00.000Z", limitAmount: 100, currency: "RUBL" }).success).toBe(false);
  });
});
