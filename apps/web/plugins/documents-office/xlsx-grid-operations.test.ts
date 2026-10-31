import { describe, expect, it } from "vitest";
import type { WorkbookState } from "./codecs/xlsx-codec";
import {
  EXCEL_MAX_COLS, EXCEL_MAX_ROWS, addWorksheet, applyGridChanges, cellAddress,
  cellInputText, clipboardChanges, columnLabel, parseCellAddress, parseClipboardGrid, renameWorksheet
} from "./xlsx-grid-operations";

function fixture(): WorkbookState {
  return {
    sheets: [
      { name: "Data", rows: [[{ value: 10, numFmt: "0.00" }, { value: null, formula: "A1*2" }]], merges: ["C3:D3"], columnWidths: { 1: 14 } },
      { name: "Summary", rows: [[{ value: null, formula: "Data!A1" }]] }
    ],
    charts: [{ sheetId: "Data", dataRange: "A1:B2", chartType: "bar" }],
    pivotTables: [{ sheetId: "Data", sourceRange: "A1:B2", targetCell: "D1", rowFields: ["Name"], valueFields: [{ name: "Total" }] }]
  };
}

describe("xlsx editor grid operations", () => {
  it("parses and formats addresses including the last XLSX cell", () => {
    expect(parseCellAddress("A1")).toEqual({ row: 0, col: 0 });
    expect(parseCellAddress("$AA$201")).toEqual({ row: 200, col: 26 });
    expect(parseCellAddress("XFD1048576")).toEqual({ row: EXCEL_MAX_ROWS - 1, col: EXCEL_MAX_COLS - 1 });
    expect(cellAddress(200, 26)).toBe("AA201");
    expect(columnLabel(EXCEL_MAX_COLS - 1)).toBe("XFD");
    expect(parseCellAddress("XFE1")).toBeNull();
    expect(parseCellAddress("A1048577")).toBeNull();
    expect(parseCellAddress("A0")).toBeNull();
  });

  it("edits numbers, formulas and text without mutating the input or dropping formatting", () => {
    const original = fixture();
    const modified = applyGridChanges(original, 0, [
      { row: 0, col: 0, text: "25" },
      { row: 0, col: 1, text: "=A1*3" },
      { row: 1, col: 0, text: "00123" },
      { row: 1, col: 1, text: "'005" },
      { row: 200, col: 0, text: "Beyond former 200-row limit" }
    ]);
    expect(original.sheets[0].rows[0][0].value).toBe(10);
    expect(modified.sheets[0].rows[0][0]).toEqual({ value: 25, numFmt: "0.00" });
    expect(cellInputText(modified.sheets[0].rows[0][1])).toBe("=A1*3");
    expect(modified.sheets[0].rows[1][0].value).toBe("00123");
    expect(modified.sheets[0].rows[1][1].value).toBe("005");
    expect(modified.sheets[0].rows[200][0].value).toBe("Beyond former 200-row limit");
    expect(modified.sheets[0].merges).toEqual(["C3:D3"]);
    expect(modified.sheets[0].columnWidths).toEqual({ 1: 14 });
    expect(modified.charts).toEqual(original.charts);
    expect(modified.pivotTables).toEqual(original.pivotTables);
    expect(modified.sheets[1]).toBe(original.sheets[1]);
  });

  it("pastes Excel TSV into a target range, handling quotes, CRLF, and formulas", () => {
    expect(parseClipboardGrid('"Hello\tthere"\t42\r\n"New\nline"\t=A1*2\r\n')).toEqual([
      ["Hello\tthere", "42"], ["New\nline", "=A1*2"]
    ]);
    const changes = clipboardChanges("Title\tCount\nNorth\t15\nSouth\t20\n", 4, 2);
    expect(changes).toHaveLength(6);
    const state = applyGridChanges(fixture(), 0, changes);
    expect(state.sheets[0].rows[4][2].value).toBe("Title");
    expect(state.sheets[0].rows[5][3].value).toBe(15);
    expect(state.sheets[0].rows[6][3].value).toBe(20);
    expect(() => applyGridChanges(state, 0, [{ row: EXCEL_MAX_ROWS, col: 0, text: "x" }])).toThrow("пределы");
    expect(() => clipboardChanges("a\tb", 0, EXCEL_MAX_COLS - 1).map((change) =>
      applyGridChanges(state, 0, [change])
    )).toThrow("пределы");
  });

  it("adds and renames sheets with formula, chart and pivot references kept consistent", () => {
    const original = fixture();
    const added = addWorksheet(original);
    expect(added.sheets[added.sheets.length - 1]?.name).toBe("Лист 1");
    const renamed = renameWorksheet(added, 0, "Продажи 2026");
    expect(renamed.sheets[0].name).toBe("Продажи 2026");
    expect(renamed.sheets[1].rows[0][0].formula).toBe("'Продажи 2026'!A1");
    expect(renamed.charts?.[0].sheetId).toBe("Продажи 2026");
    expect(renamed.pivotTables?.[0].sheetId).toBe("Продажи 2026");
    expect(original.sheets[0].name).toBe("Data");
    expect(() => renameWorksheet(added, 0, "Summary")).toThrow("существует");
    expect(() => renameWorksheet(added, 0, "Invalid/Name")).toThrow("Имя листа");
  });
});
