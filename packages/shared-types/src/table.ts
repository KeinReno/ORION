import { z } from "zod";

/**
 * Задание 10.1 — Orion Tables (общий инструмент, не предметный модуль).
 *
 * Здесь только контракт и чистая логика: типы колонок, разбор/вычисление формул,
 * проверка значений строк и CSV. Сервер (`apps/api/src/tables/`) не дублирует ни
 * одно из этих правил, клиент при необходимости переиспользует их же — поэтому
 * «что значит корректная ячейка» и «что вернёт формула» не могут разойтись между
 * API и интерфейсом.
 */

export const TABLE_COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
  "formula",
  "link"
] as const;
export const tableColumnTypeSchema = z.enum(TABLE_COLUMN_TYPES);
export type TableColumnType = z.infer<typeof tableColumnTypeSchema>;

/** Типы сущностей, на которые можно ссылаться link-колонкой. Проверка существования — публичный контракт владельца. */
export const TABLE_LINK_ENTITY_TYPES = ["task", "project"] as const;
export const tableLinkEntityTypeSchema = z.enum(TABLE_LINK_ENTITY_TYPES);
export type TableLinkEntityType = z.infer<typeof tableLinkEntityTypeSchema>;

/** Идентификатор колонки: стабильный, латиницей, чтобы на него можно было сослаться в формуле. */
export const tableColumnIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, "Идентификатор колонки: латиница, цифры и «_», начинается с буквы");

export const TABLE_AGGREGATE_FUNCTIONS = ["sum", "avg", "count", "min", "max"] as const;
export type TableAggregateFunction = (typeof TABLE_AGGREGATE_FUNCTIONS)[number];

/** Значение ячейки в хранилище. Формульные колонки не хранят значение — оно вычисляется при чтении. */
export type TableCellValue = string | number | boolean | null;
export type TableRowValues = Record<string, unknown>;

/**
 * Колонка таблицы. `options` — только для `select`, `formula` — только для
 * `formula`, `linkType` — только для `link`. Лишние поля отклоняются: опечатка
 * клиента не должна молча создать колонку без вариантов выбора.
 */
export const tableColumnSchema = z
  .object({
    id: tableColumnIdSchema,
    name: z.string().trim().min(1).max(120),
    type: tableColumnTypeSchema,
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
    formula: z.string().trim().min(1).max(500).optional(),
    linkType: tableLinkEntityTypeSchema.optional()
  })
  .strict()
  .superRefine((column, ctx) => {
    const reject = (field: "options" | "formula" | "linkType", message: string): void => {
      if (column[field] !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
    };
    if (column.type === "select") {
      if (!column.options?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Для колонки-выбора нужны варианты" });
      else if (new Set(column.options).size !== column.options.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Варианты выбора не должны повторяться" });
      }
      reject("formula", "Формула допустима только для колонки-формулы");
      reject("linkType", "Тип ссылки допустим только для колонки-ссылки");
      return;
    }
    if (column.type === "formula") {
      if (!column.formula) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["formula"], message: "Для колонки-формулы нужна формула" });
      else {
        try {
          parseTableFormula(column.formula);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["formula"],
            message: error instanceof Error ? error.message : "Некорректная формула"
          });
        }
      }
      reject("options", "Варианты выбора допустимы только для колонки-выбора");
      reject("linkType", "Тип ссылки допустим только для колонки-ссылки");
      return;
    }
    if (column.type === "link") {
      if (!column.linkType) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["linkType"], message: "Для колонки-ссылки нужен тип сущности" });
      reject("options", "Варианты выбора допустимы только для колонки-выбора");
      reject("formula", "Формула допустима только для колонки-формулы");
      return;
    }
    reject("options", "Варианты выбора допустимы только для колонки-выбора");
    reject("formula", "Формула допустима только для колонки-формулы");
    reject("linkType", "Тип ссылки допустим только для колонки-ссылки");
  });

export type TableColumn = z.infer<typeof tableColumnSchema>;

export const tableColumnsSchema = z
  .array(tableColumnSchema)
  .min(1)
  .max(50)
  .superRefine((columns, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    columns.forEach((column, index) => {
      if (ids.has(column.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `Идентификатор «${column.id}» повторяется` });
      ids.add(column.id);
      const name = column.name.toLocaleLowerCase("ru");
      if (names.has(name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "name"], message: `Название «${column.name}» повторяется` });
      names.add(name);
    });
    // Ссылки внутри формул проверяются отдельной функцией: ей нужны все колонки,
    // а не одна, и та же логика используется при изменении схемы у таблицы с данными.
    for (const issue of validateTableColumns(columns)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: issue });
    }
  });

// ---------------------------------------------------------------------------
// Формулы
// ---------------------------------------------------------------------------

type FormulaToken =
  | { kind: "number"; value: number }
  | { kind: "cell"; columnId: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "open" }
  | { kind: "close" };

export interface FormulaNumber {
  kind: "number";
  value: number;
}
export interface FormulaCell {
  kind: "cell";
  columnId: string;
}
export interface FormulaUnary {
  kind: "unary";
  operator: "+" | "-";
  operand: FormulaExpression;
}
export interface FormulaBinary {
  kind: "binary";
  operator: "+" | "-" | "*" | "/";
  left: FormulaExpression;
  right: FormulaExpression;
}
export type FormulaExpression = FormulaNumber | FormulaCell | FormulaUnary | FormulaBinary;

export interface AggregateFormula {
  kind: "aggregate";
  fn: TableAggregateFunction;
  columnId: string;
}
export interface RowFormula {
  kind: "row";
  expression: FormulaExpression;
}
export type ParsedTableFormula = AggregateFormula | RowFormula;

export class TableFormulaError extends Error {}

const CELL_REFERENCE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

function tokenizeExpression(source: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      const end = source.indexOf("}", index + 1);
      if (end === -1) throw new TableFormulaError("Не закрыта ссылка на ячейку «{…}»");
      const columnId = source.slice(index + 1, end).trim();
      if (!CELL_REFERENCE.test(columnId)) throw new TableFormulaError(`Некорректная ссылка на ячейку «${columnId}»`);
      tokens.push({ kind: "cell", columnId });
      index = end + 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ kind: "open" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ kind: "close" });
      index += 1;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(source.slice(index));
      if (!match) throw new TableFormulaError("Ожидалось число");
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    throw new TableFormulaError(`Неожиданный символ «${char}» в формуле`);
  }
  return tokens;
}

function parseExpression(tokens: readonly FormulaToken[]): FormulaExpression {
  let position = 0;
  const peek = (): FormulaToken | undefined => tokens[position];

  function parsePrimary(): FormulaExpression {
    const token = peek();
    if (!token) throw new TableFormulaError("Формула обрывается");
    if (token.kind === "number") {
      position += 1;
      return { kind: "number", value: token.value };
    }
    if (token.kind === "cell") {
      position += 1;
      return { kind: "cell", columnId: token.columnId };
    }
    if (token.kind === "open") {
      position += 1;
      const inner = parseSum();
      const close = peek();
      if (!close || close.kind !== "close") throw new TableFormulaError("Не закрыта скобка в формуле");
      position += 1;
      return inner;
    }
    throw new TableFormulaError("Ожидалось число, ссылка на ячейку или «(»");
  }

  function parseUnary(): FormulaExpression {
    const token = peek();
    if (token?.kind === "operator" && (token.value === "+" || token.value === "-")) {
      position += 1;
      const operand = parseUnary();
      return token.value === "+" ? operand : { kind: "unary", operator: "-", operand };
    }
    return parsePrimary();
  }

  function parseProduct(): FormulaExpression {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "operator" || (token.value !== "*" && token.value !== "/")) return left;
      position += 1;
      const right = parseUnary();
      left = { kind: "binary", operator: token.value, left, right };
    }
  }

  function parseSum(): FormulaExpression {
    let left = parseProduct();
    for (;;) {
      const token = peek();
      if (!token || token.kind !== "operator" || (token.value !== "+" && token.value !== "-")) return left;
      position += 1;
      const right = parseProduct();
      left = { kind: "binary", operator: token.value, left, right };
    }
  }

  const expression = parseSum();
  if (position !== tokens.length) throw new TableFormulaError("Лишние символы в формуле");
  return expression;
}

/**
 * Разбирает формулу при записи схемы (и при валидации колонки). Две формы:
 * - агрегат по всей колонке: `sum(amount)`, `avg({price})`, `count`, `min`, `max`;
 * - выражение по ячейкам той же строки: `{price} * {qty} + 5`.
 * Неизвестная функция — ошибка (сервер отвечает 422), а не молчаливая пустая ячейка.
 */
export function parseTableFormula(source: string): ParsedTableFormula {
  const text = source.trim().replace(/^=/, "").trim();
  if (!text) throw new TableFormulaError("Пустая формула");
  const aggregateMatch = /^([A-Za-z][A-Za-z0-9]*)\s*\(/.exec(text);
  if (aggregateMatch) {
    const fn = aggregateMatch[1]!.toLowerCase();
    if (!(TABLE_AGGREGATE_FUNCTIONS as readonly string[]).includes(fn)) {
      throw new TableFormulaError(`Неизвестная функция «${aggregateMatch[1]}» (доступны: ${TABLE_AGGREGATE_FUNCTIONS.join(", ")})`);
    }
    let rest = text.slice(aggregateMatch[0].length).trim();
    let columnId: string;
    if (rest.startsWith("{")) {
      const end = rest.indexOf("}");
      if (end === -1) throw new TableFormulaError("Не закрыта ссылка на колонку в формуле");
      columnId = rest.slice(1, end).trim();
      rest = rest.slice(end + 1).trim();
    } else {
      const closing = rest.indexOf(")");
      if (closing === -1) throw new TableFormulaError("Агрегат записывается как sum(колонка)");
      columnId = rest.slice(0, closing).trim();
      rest = rest.slice(closing).trim();
    }
    if (!CELL_REFERENCE.test(columnId)) throw new TableFormulaError(`Некорректная ссылка на колонку «${columnId}»`);
    if (!rest.startsWith(")")) throw new TableFormulaError("Не закрыта скобка агрегата");
    if (rest.slice(1).trim()) throw new TableFormulaError("Лишние символы после агрегата");
    return { kind: "aggregate", fn: fn as TableAggregateFunction, columnId };
  }
  const expression = parseExpression(tokenizeExpression(text));
  return { kind: "row", expression };
}

/** Идентификаторы колонок, на которые ссылается формула. */
export function formulaReferences(formula: ParsedTableFormula): string[] {
  if (formula.kind === "aggregate") return [formula.columnId];
  const found = new Set<string>();
  const visit = (node: FormulaExpression): void => {
    if (node.kind === "cell") found.add(node.columnId);
    else if (node.kind === "unary") visit(node.operand);
    else if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
    }
  };
  visit(formula.expression);
  return [...found];
}

function roundFormula(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Число из ячейки; всё, что не конечное число (включая пустую строку), — `null`. */
export function tableCellNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(",", ".");
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Есть ли в ячейке значение (для `count`). `false` и `0` — значения, пустая строка — нет. */
function hasCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !(typeof value === "string" && value.trim() === "");
}

function evaluateExpression(node: FormulaExpression, cells: TableRowValues): number | null {
  switch (node.kind) {
    case "number":
      return node.value;
    case "cell":
      return tableCellNumber(cells[node.columnId]);
    case "unary": {
      const value = evaluateExpression(node.operand, cells);
      return value === null ? null : -value;
    }
    case "binary": {
      const left = evaluateExpression(node.left, cells);
      const right = evaluateExpression(node.right, cells);
      if (left === null || right === null) return null;
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right === 0 ? null : left / right;
      }
    }
  }
  return null;
}

/** Вычисляет строчную формулу; `null`, если хотя бы одна ссылка не число. */
export function evaluateRowFormula(formula: RowFormula, cells: TableRowValues): number | null {
  const value = evaluateExpression(formula.expression, cells);
  return value === null ? null : roundFormula(value);
}

/** Агрегат по колонке всех строк. `count` считает непустые ячейки, остальные — только числа. */
export function evaluateAggregateFormula(
  formula: AggregateFormula,
  rows: readonly TableRowValues[]
): number | null {
  if (formula.fn === "count") {
    return rows.reduce((total, row) => total + (hasCellValue(row[formula.columnId]) ? 1 : 0), 0);
  }
  const numbers = rows
    .map((row) => tableCellNumber(row[formula.columnId]))
    .filter((value): value is number => value !== null);
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  switch (formula.fn) {
    case "sum":
      return roundFormula(total);
    case "avg":
      return roundFormula(total / numbers.length);
    case "min":
      return roundFormula(Math.min(...numbers));
    case "max":
      return roundFormula(Math.max(...numbers));
  }
  return null;
}

export interface ComputedTableValues {
  /** Для каждой строки — вычисленные значения формульных колонок строки (по id колонки). */
  rowComputed: Array<Record<string, number | null>>;
  /** Агрегатные формулы — одно значение на колонку. */
  totals: Record<string, number | null>;
}

/** Считает все формулы таблицы при чтении. Единственная реализация — и для списка строк, и для экспорта. */
export function computeTableFormulas(
  columns: readonly TableColumn[],
  rows: readonly TableRowValues[]
): ComputedTableValues {
  const parsed = new Map<string, ParsedTableFormula>();
  for (const column of columns) {
    if (column.type !== "formula" || !column.formula) continue;
    try {
      parsed.set(column.id, parseTableFormula(column.formula));
    } catch {
      // Схему с невалидной формулой записать нельзя; если строка всё же пришла из
      // старой схемы, формула считается пустой, а не роняет чтение всей таблицы.
    }
  }
  const totals: Record<string, number | null> = {};
  for (const [columnId, formula] of parsed) {
    if (formula.kind === "aggregate") totals[columnId] = evaluateAggregateFormula(formula, rows);
  }
  const rowComputed = rows.map((row) => {
    const computed: Record<string, number | null> = {};
    for (const [columnId, formula] of parsed) {
      if (formula.kind === "row") computed[columnId] = evaluateRowFormula(formula, row);
    }
    return computed;
  });
  return { rowComputed, totals };
}

// ---------------------------------------------------------------------------
// Валидация схемы и значений
// ---------------------------------------------------------------------------

/** Ошибки схемы, которые не ловятся одной колонкой: ссылки формул и запрет цепочек. */
export function validateTableColumns(columns: readonly TableColumn[]): string[] {
  const issues: string[] = [];
  const byId = new Map(columns.map((column) => [column.id, column]));
  const formulaByColumn = new Map<string, ParsedTableFormula>();
  for (const column of columns) {
    if (column.type !== "formula" || !column.formula) continue;
    try {
      formulaByColumn.set(column.id, parseTableFormula(column.formula));
    } catch (error) {
      issues.push(`Колонка «${column.name}»: ${error instanceof Error ? error.message : "некорректная формула"}`);
    }
  }
  for (const column of columns) {
    if (column.type !== "formula") continue;
    const formula = formulaByColumn.get(column.id);
    if (!formula) continue;
    for (const reference of formulaReferences(formula)) {
      const target = byId.get(reference);
      if (!target) {
        issues.push(`Колонка «${column.name}»: в формуле нет колонки «${reference}»`);
        continue;
      }
      // Формула на формулу — это скрытая рекурсия (и возможный цикл) при чтении.
      // Пользователь всегда может скопировать выражение в новую колонку.
      if (target.type === "formula") {
        issues.push(`Колонка «${column.name}»: формула не может ссылаться на формулу «${target.name}»`);
      }
    }
  }
  return issues;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Проверяет одну ячейку по типу колонки. Возвращает текст ошибки или `null`. */
export function validateTableCell(column: TableColumn, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (column.type === "formula") return "Значение формульной колонки вычисляется, его нельзя записать";
  switch (column.type) {
    case "text":
      return typeof value === "string" && value.length <= 20_000 ? null : "Ожидается текст";
    case "number":
      return tableCellNumber(value) !== null && typeof value === "number" ? null : "Ожидается число";
    case "date": {
      if (typeof value !== "string" || !DATE_PATTERN.test(value)) return "Ожидается дата ГГГГ-ММ-ДД";
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? "Такой даты нет" : null;
    }
    case "select":
      return typeof value === "string" && (column.options ?? []).includes(value)
        ? null
        : `Ожидается один из вариантов: ${(column.options ?? []).join(", ")}`;
    case "checkbox":
      return typeof value === "boolean" ? null : "Ожидается «да» или «нет»";
    case "url": {
      if (typeof value !== "string" || value.length > 2_000) return "Ожидается ссылка http(s)";
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? null : "Ожидается ссылка http(s)";
      } catch {
        return "Ожидается ссылка http(s)";
      }
    }
    case "link":
      return typeof value === "string" && value.trim().length > 0 && value.length <= 100
        ? null
        : `Ожидается id сущности «${column.linkType}»`;
    default:
      return null;
  }
}

/** Проверяет набор значений строки целиком: неизвестные колонки и значения формул запрещены. */
export function validateTableRowValues(columns: readonly TableColumn[], values: TableRowValues): string[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const issues: string[] = [];
  for (const key of Object.keys(values)) {
    const column = byId.get(key);
    if (!column) {
      issues.push(`Колонки «${key}» нет в схеме таблицы`);
      continue;
    }
    const problem = validateTableCell(column, values[key]);
    if (problem) issues.push(`Колонка «${column.name}»: ${problem}`);
  }
  return issues;
}

/**
 * Приводит ячейку CSV к типу колонки. Возвращает значение либо текст ошибки.
 * `checkbox` понимает `true/false/1/0/да/нет`; пустая строка — `null`.
 */
export function coerceCsvCell(column: TableColumn, raw: string): { value: TableCellValue } | { error: string } {
  const text = raw.trim();
  if (text === "") return { value: null };
  switch (column.type) {
    case "text":
    case "url":
    case "link":
      return { value: text };
    case "number": {
      const value = tableCellNumber(text);
      return value === null ? { error: "Ожидается число" } : { value };
    }
    case "date":
      return DATE_PATTERN.test(text) ? { value: text } : { error: "Ожидается дата ГГГГ-ММ-ДД" };
    case "select":
      return (column.options ?? []).includes(text) ? { value: text } : { error: `Ожидается один из вариантов: ${(column.options ?? []).join(", ")}` };
    case "checkbox": {
      const lower = text.toLocaleLowerCase("ru");
      if (["true", "1", "да", "yes"].includes(lower)) return { value: true };
      if (["false", "0", "нет", "no"].includes(lower)) return { value: false };
      return { error: "Ожидается «да» или «нет»" };
    }
    case "formula":
      return { error: "Формульную колонку нельзя импортировать: значение вычисляется" };
  }
}

// ---------------------------------------------------------------------------
// CSV (импорт/экспорт)
// ---------------------------------------------------------------------------

/**
 * Разбирает CSV: кавычки, удвоенные кавычки, переводы строк внутри ячеек.
 * Разделитель определяется по первой строке (`;` или `,`) — русский Excel
 * сохраняет `;`, остальные инструменты — `,`. Это и есть «маппинг колонок»:
 * порядок ячеек берётся из заголовка, а не из позиции в файле.
 */
export function parseTableCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

function detectDelimiter(source: string): string {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const char of source.split("\n")[0] ?? "") {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ";") semicolons += 1;
    else if (!quoted && char === ",") commas += 1;
  }
  return semicolons > commas ? ";" : ",";
}

function escapeCsv(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Экспорт строк в CSV по колонкам схемы; формульные колонки выгружаются вычисленными значениями. */
export function tableToCsv(columns: readonly TableColumn[], rows: readonly TableRowValues[], computed?: ComputedTableValues): string {
  const header = columns.map((column) => escapeCsv(column.name)).join(",");
  const lines = rows.map((row, index) => {
    const cells = columns.map((column) => {
      const value = column.type === "formula" ? computed?.rowComputed[index]?.[column.id] : row[column.id];
      if (value === null || value === undefined) return "";
      if (typeof value === "boolean") return value ? "true" : "false";
      return escapeCsv(String(value));
    });
    return cells.join(",");
  });
  return [header, ...lines].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// DTO и входные схемы API
// ---------------------------------------------------------------------------

export const tableDefinitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  columns: z.array(tableColumnSchema),
  rowCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TableDefinition = z.infer<typeof tableDefinitionSchema>;

export const tableRowSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  values: z.record(z.unknown()),
  /** Вычисленные формульные колонки этой строки. */
  computed: z.record(z.number().nullable()),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type TableRow = z.infer<typeof tableRowSchema>;

export const tableReadResultSchema = z.object({
  definition: tableDefinitionSchema,
  rows: z.array(tableRowSchema),
  /** Агрегатные формулы таблицы (`sum`/`avg`/…): одно значение на колонку. */
  totals: z.record(z.number().nullable())
});
export type TableReadResult = z.infer<typeof tableReadResultSchema>;

export const createTableInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    columns: tableColumnsSchema
  })
  .strict();
export type CreateTableInput = z.infer<typeof createTableInputSchema>;

export const updateTableInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    columns: tableColumnsSchema.optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.columns !== undefined, { message: "Нечего менять" });
export type UpdateTableInput = z.infer<typeof updateTableInputSchema>;

export const createTableRowInputSchema = z
  .object({
    values: z.record(z.unknown()),
    position: z.number().int().min(0).optional()
  })
  .strict();
export type CreateTableRowInput = z.infer<typeof createTableRowInputSchema>;

export const updateTableRowInputSchema = z
  .object({
    values: z.record(z.unknown())
  })
  .strict();
export type UpdateTableRowInput = z.infer<typeof updateTableRowInputSchema>;

export const reorderTableRowsInputSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(5_000)
  })
  .strict();
export type ReorderTableRowsInput = z.infer<typeof reorderTableRowsInputSchema>;

/** Колонка импорта: та же схема, но без формул и с указанием заголовка CSV, из которого берутся значения. */
export const tableImportColumnSchema = z
  .object({
    id: tableColumnIdSchema,
    name: z.string().trim().min(1).max(120),
    type: tableColumnTypeSchema.exclude(["formula"]),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
    linkType: tableLinkEntityTypeSchema.optional(),
    sourceHeader: z.string().trim().min(1).max(200)
  })
  .strict();
export type TableImportColumn = z.infer<typeof tableImportColumnSchema>;

export const importTableCsvInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    csv: z.string().min(1).max(2_000_000),
    columns: z.array(tableImportColumnSchema).min(1).max(50)
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    const headers = new Set<string>();
    value.columns.forEach((column, index) => {
      if (ids.has(column.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns", index, "id"], message: `Идентификатор «${column.id}» повторяется` });
      ids.add(column.id);
      const name = column.name.toLocaleLowerCase("ru");
      if (names.has(name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns", index, "name"], message: `Название «${column.name}» повторяется` });
      names.add(name);
      const header = column.sourceHeader.toLocaleLowerCase("ru");
      if (headers.has(header)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns", index, "sourceHeader"], message: `Заголовок «${column.sourceHeader}» указан дважды` });
      headers.add(header);
      if (column.type === "select" && !column.options?.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns", index, "options"], message: "Для колонки-выбора нужны варианты" });
      }
      if (column.type === "link" && !column.linkType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["columns", index, "linkType"], message: "Для колонки-ссылки нужен тип сущности" });
      }
    });
  });
export type ImportTableCsvInput = z.infer<typeof importTableCsvInputSchema>;

export const importTableCsvResultSchema = z.object({
  definition: tableDefinitionSchema,
  importedRows: z.number().int().nonnegative()
});
export type ImportTableCsvResult = z.infer<typeof importTableCsvResultSchema>;
