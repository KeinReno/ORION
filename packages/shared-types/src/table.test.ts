import { describe, expect, it } from "vitest";
import {
  coerceCsvCell,
  computeTableFormulas,
  evaluateAggregateFormula,
  evaluateRowFormula,
  parseTableCsv,
  parseTableFormula,
  tableColumnsSchema,
  tableToCsv,
  validateTableColumns,
  validateTableRowValues,
  type TableColumn
} from "./table";

const columns = (): TableColumn[] => [
  { id: "name", name: "Название", type: "text" },
  { id: "amount", name: "Сумма", type: "number" },
  { id: "qty", name: "Количество", type: "number" },
  { id: "sumAmount", name: "Итог", type: "formula", formula: "sum(amount)" },
  { id: "total", name: "Сумма строки", type: "formula", formula: "{amount} * {qty}" }
];

describe("формулы таблиц", () => {
  it("разбирает агрегат и выражение по ячейкам", () => {
    expect(parseTableFormula("sum(amount)")).toEqual({ kind: "aggregate", fn: "sum", columnId: "amount" });
    expect(parseTableFormula("=AVG({amount})")).toEqual({ kind: "aggregate", fn: "avg", columnId: "amount" });
    expect(parseTableFormula("{amount} * {qty} + 5")).toMatchObject({ kind: "row" });
  });

  it("отклоняет неизвестную функцию", () => {
    expect(() => parseTableFormula("median(amount)")).toThrow(/Неизвестная функция/);
  });

  it("считает агрегаты по колонке", () => {
    const formula = parseTableFormula("sum(amount)");
    if (formula.kind !== "aggregate") throw new Error("ожидался агрегат");
    const rows = [{ amount: 10 }, { amount: 20 }, { amount: null }, { amount: "5" }];
    expect(evaluateAggregateFormula(formula, rows)).toBe(35);
    expect(evaluateAggregateFormula({ ...formula, fn: "avg" }, rows)).toBeCloseTo(35 / 3, 6);
    expect(evaluateAggregateFormula({ ...formula, fn: "count" }, rows)).toBe(3);
    expect(evaluateAggregateFormula({ ...formula, fn: "min" }, rows)).toBe(5);
    expect(evaluateAggregateFormula({ ...formula, fn: "max" }, rows)).toBe(20);
  });

  it("считает строчную формулу и не делит на ноль", () => {
    const formula = parseTableFormula("{amount} * {qty}");
    if (formula.kind !== "row") throw new Error("ожидалось выражение");
    expect(evaluateRowFormula(formula, { amount: 3, qty: 4 })).toBe(12);
    expect(evaluateRowFormula(formula, { amount: 3 })).toBeNull();
    const division = parseTableFormula("{amount} / {qty}");
    if (division.kind !== "row") throw new Error("ожидалось выражение");
    expect(evaluateRowFormula(division, { amount: 3, qty: 0 })).toBeNull();
  });

  it("на чтении отдаёт и итоги, и значения строк", () => {
    const rows = [
      { name: "a", amount: 10, qty: 2 },
      { name: "b", amount: 20, qty: 3 }
    ];
    const computed = computeTableFormulas(columns(), rows);
    expect(computed.totals).toEqual({ sumAmount: 30 });
    expect(computed.rowComputed).toEqual([{ total: 20 }, { total: 60 }]);
  });
});

describe("валидация схемы и значений", () => {
  it("запрещает формулу на формулу и ссылку на несуществующую колонку", () => {
    const issues = validateTableColumns([
      { id: "a", name: "A", type: "number" },
      { id: "f1", name: "F1", type: "formula", formula: "sum(a)" },
      { id: "f2", name: "F2", type: "formula", formula: "{f1} + 1" },
      { id: "f3", name: "F3", type: "formula", formula: "{missing} + 1" }
    ]);
    expect(issues.some((issue) => issue.includes("не может ссылаться на формулу"))).toBe(true);
    expect(issues.some((issue) => issue.includes("нет колонки"))).toBe(true);
  });

  it("схема с неизвестной функцией не проходит zod-схему", () => {
    const parsed = tableColumnsSchema.safeParse([{ id: "f", name: "F", type: "formula", formula: "median(a)" }]);
    expect(parsed.success).toBe(false);
  });

  it("проверяет типы ячеек", () => {
    const select: TableColumn = { id: "s", name: "Статус", type: "select", options: ["a", "b"] };
    expect(validateTableRowValues([select], { s: "c" })).toHaveLength(1);
    expect(validateTableRowValues([select], { s: "a" })).toHaveLength(0);
    const date: TableColumn = { id: "d", name: "Дата", type: "date" };
    expect(validateTableRowValues([date], { d: "2026-02-30" })[0]).toContain("Такой даты нет");
    const checkbox: TableColumn = { id: "c", name: "Галочка", type: "checkbox" };
    expect(validateTableRowValues([checkbox], { c: 1 })).toHaveLength(1);
    const link: TableColumn = { id: "l", name: "Задача", type: "link", linkType: "task" };
    expect(validateTableRowValues([link], { l: "task-1" })).toHaveLength(0);
    // Лишняя колонка — ошибка, а не молчаливая запись «в никуда».
    expect(validateTableRowValues(columns(), { unknown: 1 })[0]).toContain("нет в схеме");
  });
});

describe("CSV", () => {
  it("разбирает кавычки, переводы строк и точку с запятой", () => {
    expect(parseTableCsv('a;"b;c"\nd;"x\ny"')).toEqual([
      ["a", "b;c"],
      ["d", "x\ny"]
    ]);
  });

  it("приводит ячейки к типам колонок", () => {
    expect(coerceCsvCell({ id: "n", name: "N", type: "number" }, " 12,5 ")).toEqual({ value: 12.5 });
    expect(coerceCsvCell({ id: "c", name: "C", type: "checkbox" }, "да")).toEqual({ value: true });
    expect(coerceCsvCell({ id: "c", name: "C", type: "checkbox" }, "0")).toEqual({ value: false });
    expect(coerceCsvCell({ id: "d", name: "D", type: "date" }, "2026-11-11")).toEqual({ value: "2026-11-11" });
    expect(coerceCsvCell({ id: "d", name: "D", type: "date" }, "11.11.2026")).toHaveProperty("error");
  });

  it("экспортирует формульные колонки вычисленными значениями", () => {
    const rows = [{ name: "a", amount: 10, qty: 2 }];
    const csv = tableToCsv(columns(), rows, computeTableFormulas(columns(), rows));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Название,Сумма,Количество,Итог,Сумма строки");
    expect(lines[1]).toBe("a,10,2,,20");
  });
});
