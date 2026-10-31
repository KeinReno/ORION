import type { CellState, WorkbookState } from "./codecs/xlsx-codec";

/** XLSX worksheet coordinates are zero-based in the editor. */
export const EXCEL_MAX_ROWS = 1_048_576;
export const EXCEL_MAX_COLS = 16_384;

export interface GridChange {
  row: number;
  col: number;
  text: string;
}

export function columnLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function cellAddress(row: number, col: number): string {
  return columnLabel(col) + String(row + 1);
}

export function parseCellAddress(value: string): { row: number; col: number } | null {
  const match = /^\$?([A-Za-z]+)\$?([1-9]\d*)$/.exec(value.trim());
  if (!match) return null;
  let col = 0;
  for (const character of match[1].toUpperCase()) col = col * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  if (!Number.isSafeInteger(row) || row >= EXCEL_MAX_ROWS || col > EXCEL_MAX_COLS) return null;
  return { row, col: col - 1 };
}

export function cellInputText(cell: CellState | undefined): string {
  if (!cell) return "";
  if (cell.formula !== undefined) return "=" + cell.formula;
  return cell.value === null || cell.value === undefined ? "" : String(cell.value);
}

function parsedCell(text: string, previous?: CellState): CellState {
  const numFmt = previous?.numFmt;
  if (text.startsWith("=")) return { value: null, formula: text.slice(1), numFmt };
  if (text.startsWith("'")) return { value: text.slice(1), numFmt };
  if (text.trim() === "") return { value: null, numFmt };
  // Preserve identifiers like 00123 and values with surrounding spaces.
  const isNumber = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text);
  const parsed = isNumber ? Number(text) : NaN;
  return { value: Number.isFinite(parsed) ? parsed : text, numFmt };
}

/** Immutable grid update; copy only the changed rows, keep workbook metadata. */
export function applyGridChanges(workbook: WorkbookState, sheetIndex: number, changes: readonly GridChange[]): WorkbookState {
  if (changes.length === 0) return workbook;
  const oldSheet = workbook.sheets[sheetIndex];
  if (!oldSheet) throw new Error("Лист не найден.");
  const rows = oldSheet.rows.slice();
  const touched = new Set<number>();
  for (const change of changes) {
    if (!Number.isInteger(change.row) || !Number.isInteger(change.col) ||
      change.row < 0 || change.col < 0 ||
      change.row >= EXCEL_MAX_ROWS || change.col >= EXCEL_MAX_COLS) {
      throw new Error("Адрес ячейки выходит за пределы XLSX.");
    }
    if (!touched.has(change.row)) {
      rows[change.row] = [...(rows[change.row] ?? [])];
      touched.add(change.row);
    }
    rows[change.row][change.col] = parsedCell(change.text, rows[change.row][change.col]);
  }
  return { ...workbook, sheets: workbook.sheets.map((sheet, index) =>
    index === sheetIndex ? { ...sheet, rows } : sheet
  ) };
}

/** Excel clipboard is TSV, optionally quoted for tabs/newlines within a cell. */
export function parseClipboardGrid(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (ch === '"' && (quoted || field === "")) {
      quoted = !quoted;
    } else if (!quoted && ch === "\t") {
      rows[rows.length - 1].push(field);
      field = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      rows[rows.length - 1].push(field);
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows.push([]);
    } else {
      field += ch;
    }
  }
  rows[rows.length - 1].push(field);
  if (rows.length > 1 && rows[rows.length - 1].length === 1 &&
      rows[rows.length - 1][0] === "" && /[\r\n]$/.test(text)) rows.pop();
  return rows;
}

export function clipboardChanges(text: string, startRow: number, startCol: number): GridChange[] {
  const data = parseClipboardGrid(text);
  if (data.length > 10_000 || data.some((row) => row.length > 500) ||
      data.reduce((n, row) => n + row.length, 0) > 100_000) {
    throw new Error("Диапазон вставки слишком велик (максимум 100 000 ячеек за раз).");
  }
  return data.flatMap((row, r) =>
    row.map((cell, c) => ({ row: startRow + r, col: startCol + c, text: cell }))
  );
}

export function addWorksheet(workbook: WorkbookState): WorkbookState {
  let i = 1;
  while (workbook.sheets.some((sheet) => sheet.name.toLocaleLowerCase() === ("Лист " + i).toLocaleLowerCase())) i++;
  return { ...workbook, sheets: [...workbook.sheets, { name: "Лист " + i, rows: [] }] };
}

export function renameWorksheet(workbook: WorkbookState, sheetIndex: number, name: string): WorkbookState {
  const current = workbook.sheets[sheetIndex];
  if (!current) throw new Error("Лист не найден.");
  const target = name.trim();
  if (!target || target.length > 31 || /[\\/*?:\[\]]/.test(target) || target.startsWith("'") || target.endsWith("'")) {
    throw new Error("Имя листа: от 1 до 31 символа, без \\ / * ? : [ ].");
  }
  if (workbook.sheets.some((sheet, i) => i !== sheetIndex && sheet.name.toLocaleLowerCase() === target.toLocaleLowerCase())) {
    throw new Error("Лист с таким именем уже существует.");
  }
  if (current.name === target) return workbook;
  // Keep references to the renamed sheet usable in formulas.
  const quotedOld = "'" + current.name.replace(/'/g, "''") + "'!";
  const bareOld = current.name + "!";
  const newReference = "'" + target.replace(/'/g, "''") + "'!";
  const escape = (value: string): string => value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const rewrite = (formula: string): string => {
    let value = formula.replace(new RegExp(escape(quotedOld), "g"), newReference);
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(current.name)) {
      value = value.replace(new RegExp("(^|[^A-Za-z0-9_'])" + escape(bareOld), "g"), "$1" + newReference);
    }
    return value;
  };
  return {
    ...workbook,
    sheets: workbook.sheets.map((sheet, i) => ({
      ...sheet, name: i === sheetIndex ? target : sheet.name,
      rows: sheet.rows.map((row) => row.map((cell) =>
        cell.formula !== undefined ? { ...cell, formula: rewrite(cell.formula) } : cell
      ))
    })),
    charts: workbook.charts?.map((chart) => ({
      ...chart, sheetId: chart.sheetId === current.name ? target : chart.sheetId
    })),
    pivotTables: workbook.pivotTables?.map((pivot) => ({
      ...pivot, sheetId: pivot.sheetId === current.name ? target : pivot.sheetId
    }))
  };
}
