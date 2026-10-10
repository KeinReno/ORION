import { describe, expect, it } from "vitest";
import { parseDateToken, parseQuickEntry } from "./finance-quick-entry";

const NOW = new Date(2026, 9, 10, 15, 30); // 10 Oct 2026, local

function draft(input: string) {
  const result = parseQuickEntry(input, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

describe("parseQuickEntry", () => {
  it("reads sign, amount, note and tags", () => {
    expect(draft("-500 хлеб #еда")).toMatchObject({ amountMinor: 50000, direction: "expense", note: "хлеб", tags: ["еда"], date: null, categoryHint: "хлеб" });
  });
  it("a plus is income; no sign means the text did not say (the form must ask)", () => {
    expect(draft("+80000 аванс").direction).toBe("income");
    expect(draft("500 хлеб").direction).toBeNull();
  });
  it("finds the amount anywhere and keeps the words around it, in order", () => {
    expect(draft("кофе -250,50 с собой")).toMatchObject({ amountMinor: 25050, note: "кофе с собой" });
  });
  it("collects several tags once each", () => {
    expect(draft("-100 такси #работа #такси #работа").tags).toEqual(["работа", "такси"]);
  });
  it("reads a date token", () => {
    const d = draft("-100 обед @вчера").date!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 9]);
    const e = draft("-100 обед @03.02").date!;
    expect([e.getFullYear(), e.getMonth(), e.getDate()]).toEqual([2026, 1, 3]);
  });
  it("does not mistake digits inside words or an @date for the amount", () => {
    expect(draft("-100 рейс a320 @2026-10-01").amountMinor).toBe(10000);
  });
  it("explains what it could not read instead of guessing", () => {
    expect(parseQuickEntry("хлеб", NOW)).toEqual({ ok: false, error: "Не нашёл сумму: напишите число, например -500" });
    expect(parseQuickEntry("-100 хлеб @когда-нибудь", NOW)).toMatchObject({ ok: false });
    expect(parseQuickEntry("-1.234 хлеб", NOW)).toMatchObject({ ok: false });
    expect(parseQuickEntry("   ", NOW)).toMatchObject({ ok: false });
  });
});

describe("parseDateToken", () => {
  it("accepts the day words and real dates only", () => {
    expect(parseDateToken("сегодня", NOW)!.getDate()).toBe(10);
    expect(parseDateToken("позавчера", NOW)!.getDate()).toBe(8);
    expect(parseDateToken("31.02", NOW)).toBeNull();
    expect(parseDateToken("2026-13-01", NOW)).toBeNull();
  });
});
