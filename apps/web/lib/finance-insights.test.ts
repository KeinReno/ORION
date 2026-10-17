import { describe, expect, it } from "vitest";
import type { Transaction } from "@orion/shared-types";
import { compareBreakdowns, topPayees, transactionsToCsv } from "./finance-insights";

const entry = (categoryId: string | null, categoryName: string, amount: number, currency = "RUB") => ({ categoryId, categoryName, currency, amount });
const tx = (patch: Partial<Transaction>): Transaction => ({
  id: "t", workspaceId: "w", accountId: "a", toAccountId: null, type: "expense", note: "Пятёрочка", tags: [], projectId: null, reconciledAt: null,
  importedRef: null, occurredAt: "2026-10-03T10:00:00.000Z", lines: [{ id: "l", categoryId: "c", amount: 1250 }], totalAmount: 1250, createdAt: "", updatedAt: "", ...patch
});

describe("compareBreakdowns", () => {
  it("orders by the size of the change and keeps «new» and «gone» categories honest", () => {
    const result = compareBreakdowns(
      [entry("food", "Еда", 30000), entry("fun", "Досуг", 5000), entry("new", "Ремонт", 7000)],
      [entry("food", "Еда", 20000), entry("fun", "Досуг", 5000), entry("old", "Такси", 4000)],
      "RUB"
    );
    expect(result.currentTotal).toBe(42000);
    expect(result.previousTotal).toBe(29000);
    expect(result.categories.map((c) => [c.categoryName, c.delta, c.ratio])).toEqual([
      ["Еда", 10000, 0.5],
      ["Ремонт", 7000, null],
      ["Такси", -4000, -1]
    ]);
  });
  it("drops unchanged categories and caps the list", () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(`c${i}`, `К${i}`, 100 * (i + 1)));
    expect(compareBreakdowns(many, [], "RUB", 3).categories).toHaveLength(3);
    expect(compareBreakdowns([entry("a", "А", 1)], [entry("a", "А", 1)], "RUB").categories).toEqual([]);
  });
  it("compares one currency only and never adds another one in", () => {
    const result = compareBreakdowns(
      [entry("food", "Еда", 30000), entry("food", "Еда", 2000, "USD")],
      [entry("food", "Еда", 20000), entry("food", "Еда", 9000, "USD")],
      "USD"
    );
    expect(result.currentTotal).toBe(2000);
    expect(result.previousTotal).toBe(9000);
    expect(result.categories.map((c) => [c.categoryName, c.delta])).toEqual([["Еда", -7000]]);
  });
});

describe("topPayees", () => {
  it("groups expenses by the normalised note, skips income and transfers", () => {
    const result = topPayees([
      tx({ note: "Пятёрочка 12", totalAmount: 1000 }),
      tx({ note: "пятёрочка", totalAmount: 2500 }),
      tx({ note: "", totalAmount: 400 }),
      tx({ note: "Зарплата", type: "income", totalAmount: 999999 }),
      tx({ note: "Накопления", type: "transfer", totalAmount: 888888 })
    ]);
    expect(result.map((p) => [p.label, p.amount, p.count])).toEqual([["Пятёрочка", 3500, 2], ["Без описания", 400, 1]]);
  });
  it("counts only the operations of the given accounts (one currency)", () => {
    const result = topPayees(
      [tx({ note: "Отель", accountId: "rub", totalAmount: 30000 }), tx({ note: "Отель", accountId: "usd", totalAmount: 2000 })],
      8,
      new Set(["usd"])
    );
    expect(result.map((p) => [p.label, p.amount, p.count])).toEqual([["Отель", 2000, 1]]);
  });
});

describe("transactionsToCsv", () => {
  const names = { account: (id: string) => `Счёт ${id}`, category: (id: string) => `Кат ${id}`, project: (id: string) => `Проект ${id}` };
  it("writes a BOM, semicolons, signed rubles with a comma and escapes quotes", () => {
    const csv = transactionsToCsv([tx({ note: 'Молоко; "Простоквашино"', projectId: "p", tags: ["еда", "дом"] }), tx({ type: "income", totalAmount: 100050, lines: [{ id: "l", categoryId: null, amount: 100050 }] })], names);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe("Дата;Тип;Счёт;На счёт;Категория;Сумма;Заметка;Теги;Проект");
    expect(lines[1]).toBe('2026-10-03;Расход;Счёт a;;Кат c;-12,50;"Молоко; ""Простоквашино""";"еда, дом";Проект p'.replace('"еда, дом"', "еда, дом"));
    expect(lines[2]).toBe("2026-10-03;Доход;Счёт a;;;1000,50;Пятёрочка;;");
  });
  it("shows both accounts of a transfer", () => {
    const csv = transactionsToCsv([tx({ type: "transfer", toAccountId: "b", lines: [{ id: "l", categoryId: null, amount: 500 }], totalAmount: 500 })], names);
    expect(csv.trimEnd().split("\r\n")[1]).toBe("2026-10-03;Перевод;Счёт a;Счёт b;;5,00;Пятёрочка;;");
  });
});
