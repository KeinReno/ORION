import { describe, expect, it } from "vitest";
import { buildImportRows, detectColumns, fileFingerprint, hasHeader, importRef, parseAmount, parseCsv, parseImportDate } from "./finance-csv";

describe("parseCsv", () => {
  it("handles quotes, embedded delimiters, doubled quotes and a BOM", () => {
    const table = parseCsv('﻿a,b,c\n1,"x, y","say ""hi"""\n');
    expect(table).toEqual([["a", "b", "c"], ["1", "x, y", 'say "hi"']]);
  });
  it("detects semicolon and tab delimiters from the header line", () => {
    expect(parseCsv("дата;сумма\n01.02.2026;100,50")).toEqual([["дата", "сумма"], ["01.02.2026", "100,50"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps newlines inside quoted cells and drops blank lines", () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n\n')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });
});

describe("parseAmount", () => {
  it("reads money digit by digit, never through floats", () => {
    expect(parseAmount("0.10")).toEqual({ minor: 10, negative: false });
    expect(parseAmount("1 234,56")).toEqual({ minor: 123456, negative: false });
    expect(parseAmount("19.99")).toEqual({ minor: 1999, negative: false });
    expect(parseAmount("1234.5")).toEqual({ minor: 123450, negative: false });
  });
  it("reads the sign, brackets and currency marks", () => {
    expect(parseAmount("-500")).toEqual({ minor: 50000, negative: true });
    expect(parseAmount("−500,00 ₽")).toEqual({ minor: 50000, negative: true });
    expect(parseAmount("(12.30)")).toEqual({ minor: 1230, negative: true });
    expect(parseAmount("+7")).toEqual({ minor: 700, negative: false });
  });
  it("refuses what it cannot read exactly", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.234")).toBeNull(); // would round
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("99999999999")).toBeNull(); // over the Int range
    expect(parseAmount("1,2,3")).toBeNull();
  });
});

describe("parseImportDate", () => {
  it("reads ISO, dotted and slashed dates; a bare date is local noon", () => {
    expect(parseImportDate("2026-03-05")).toBe(new Date(2026, 2, 5, 12, 0).toISOString());
    expect(parseImportDate("05.03.2026")).toBe(new Date(2026, 2, 5, 12, 0).toISOString());
    expect(parseImportDate("5/3/26")).toBe(new Date(2026, 2, 5, 12, 0).toISOString());
    expect(parseImportDate("05.03.2026 14:30")).toBe(new Date(2026, 2, 5, 14, 30).toISOString());
    expect(parseImportDate("2026-03-05T10:00:00.000Z")).toBe("2026-03-05T10:00:00.000Z"); // a full ISO instant is kept as it is
  });
  it("rejects dates that do not exist instead of rolling them over", () => {
    expect(parseImportDate("31.02.2026")).toBeNull();
    expect(parseImportDate("2026-13-01")).toBeNull();
    expect(parseImportDate("вчера")).toBeNull();
  });
});

describe("columns", () => {
  it("recognises FinControl's export header", () => {
    const header = ["occurredAt", "amount", "type", "note", "categoryName"];
    expect(hasHeader(header)).toBe(true);
    expect(detectColumns(header)).toEqual({ date: 0, amount: 1, type: 2, note: 3, category: 4 });
  });
  it("recognises a Russian bank header with debit/credit columns", () => {
    expect(detectColumns(["Дата операции", "Описание", "Расход", "Приход"])).toEqual({ date: 0, note: 1, debit: 2, credit: 3 });
  });
  it("treats a data row as data", () => {
    expect(hasHeader(["2026-01-01", "100", "expense", "x", ""])).toBe(false);
  });
});

describe("buildImportRows", () => {
  it("imports FinControl's own export: positive amounts and an explicit type", () => {
    const table = parseCsv("occurredAt,amount,type,note,categoryName\n2026-03-05,500.00,EXPENSE,Хлеб,Продукты\n2026-03-06,80000,INCOME,Аванс,Зарплата\n");
    const result = buildImportRows(table, { direction: "sign" });
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.type, r.amount, r.note, r.categoryName])).toEqual([
      ["expense", 50000, "Хлеб", "Продукты"],
      ["income", 8000000, "Аванс", "Зарплата"]
    ]);
    expect(result.categoryNames).toEqual(["Продукты", "Зарплата"]);
  });

  it("uses the sign as the direction only when asked to; otherwise a fixed direction", () => {
    const table = parseCsv("date,amount,note\n01.03.2026,-100,a\n02.03.2026,250,b\n");
    const bySign = buildImportRows(table, { direction: "sign" });
    expect(bySign.rows.map((r) => r.type)).toEqual(["expense", "income"]);
    const fixed = buildImportRows(table, { direction: "expense" });
    expect(fixed.rows.map((r) => r.type)).toEqual(["expense", "expense"]);
  });

  it("reads separate debit and credit columns and rejects a row that fills both", () => {
    const table = parseCsv("Дата;Расход;Приход;Описание\n01.03.2026;100;;кофе\n02.03.2026;;900;аванс\n03.03.2026;5;5;странно\n");
    const result = buildImportRows(table, { direction: "sign" });
    expect(result.rows.map((r) => [r.type, r.amount])).toEqual([["expense", 10000], ["income", 90000]]);
    expect(result.errors).toEqual([{ line: 4, reason: "Заполнены и расход, и приход" }]);
  });

  it("reports unreadable rows with their file line and never repairs them", () => {
    const table = parseCsv("date,amount,type\nзавтра,100,expense\n2026-03-05,abc,expense\n2026-03-05,10,перевод\n2026-03-05,10,expense\n");
    const result = buildImportRows(table, { direction: "sign" });
    expect(result.rows).toHaveLength(1);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(result.errors[2]!.reason).toContain("Неизвестный тип");
  });
});

describe("idempotency keys", () => {
  it("is stable for the same text (line endings and outer whitespace do not matter) and differs for different text", async () => {
    const a = await fileFingerprint("a,b\r\n1,2\r\n");
    const b = await fileFingerprint("a,b\n1,2");
    const c = await fileFingerprint("a,b\n1,3");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("includes the account, so the same file into another account is a different import", () => {
    expect(importRef("abc", "acc1", 5)).toBe("csv:abc:acc1:5");
    expect(importRef("abc", "acc1", 5)).not.toBe(importRef("abc", "acc2", 5));
  });
});
