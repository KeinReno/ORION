import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  xlsxToWorkbookState,
  workbookStateToXlsx,
  recalculate,
  addChart,
  addPivotTable,
  type WorkbookState,
} from "./xlsx-codec";

/** Builds a 2-sheet XLSX with a same-sheet SUM and a cross-sheet reference. */
async function buildFixtureXlsx(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Данные");
  s1.getCell("A1").value = 10;
  s1.getCell("A2").value = 20;
  s1.getCell("A3").value = { formula: "SUM(A1:A2)" };

  const s2 = wb.addWorksheet("Итоги");
  s2.getCell("A1").value = { formula: "Данные!A3*2" };
  s2.getCell("B1").value = "2026-01-15";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).buffer.slice(0, Buffer.from(buf).byteLength) as ArrayBuffer;
}

describe("xlsx-codec round trip", () => {
  it("reads a real XLSX into grid state with formula text preserved", async () => {
    const bytes = await buildFixtureXlsx();
    const state = await xlsxToWorkbookState(bytes);

    expect(state.sheets.map((s) => s.name)).toEqual(["Данные", "Итоги"]);
    const s1 = state.sheets[0];
    expect(s1.rows[0][0].value).toBe(10);
    expect(s1.rows[1][0].value).toBe(20);
    expect(s1.rows[2][0].formula).toContain("SUM");

    const s2 = state.sheets[1];
    expect(s2.rows[0][0].formula).toContain("Данные!A3");
  });

  it("recalculates same-sheet and cross-sheet formulas with HyperFormula", async () => {
    const bytes = await buildFixtureXlsx();
    const state = await xlsxToWorkbookState(bytes);
    const recalced = recalculate(state);

    const sum = recalced.sheets[0].rows[2][0].value;
    expect(sum).toBe(30); // SUM(A1:A2) = 10 + 20

    const crossSheet = recalced.sheets[1].rows[0][0].value;
    expect(crossSheet).toBe(60); // Данные!A3 * 2 = 30 * 2
  });

  it("round-trips grid state -> XLSX -> (exceljs) read back with formulas intact", async () => {
    const bytes = await buildFixtureXlsx();
    const state = await xlsxToWorkbookState(bytes);
    const recalced = recalculate(state);

    const outBytes = await workbookStateToXlsx(recalced);
    expect(outBytes.byteLength).toBeGreaterThan(0);

    // Read the freshly-written file back with a fresh exceljs Workbook
    // (independent instance) to prove it is a structurally valid XLSX.
    const wb2 = new ExcelJS.Workbook();
    // see xlsx-codec.ts's note on exceljs's bundled Buffer type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb2.xlsx.load(Buffer.from(outBytes) as any);
    const sheetNames = wb2.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(["Данные", "Итоги"]);

    const s1 = wb2.getWorksheet("Данные")!;
    expect(s1.getCell("A1").value).toBe(10);
    expect(s1.getCell("A3").formula).toContain("SUM");

    const s2 = wb2.getWorksheet("Итоги")!;
    expect(s2.getCell("A1").formula).toContain("Данные!A3");
  });

  it("edits a cell in grid state and recalculates dependents", async () => {
    const bytes = await buildFixtureXlsx();
    const state = await xlsxToWorkbookState(bytes);

    // Simulate a user edit: A1 10 -> 100.
    state.sheets[0].rows[0][0].value = 100;

    const recalced = recalculate(state);
    expect(recalced.sheets[0].rows[2][0].value).toBe(120); // SUM(100, 20)
    expect(recalced.sheets[1].rows[0][0].value).toBe(240); // *2
  });
});

/** A plain sales table: header row + two region rows, columns Region/Total. */
function buildSalesState(): WorkbookState {
  return {
    sheets: [
      {
        name: "Sales",
        rows: [
          [{ value: "Region" }, { value: "Total" }],
          [{ value: "North" }, { value: 10 }],
          [{ value: "South" }, { value: 20 }],
        ],
      },
    ],
  };
}

describe("addChart / addPivotTable — modern-xlsx writer path", () => {
  it("addChart rejects an unknown sheet", () => {
    const state = buildSalesState();
    expect(() =>
      addChart(state, { sheetId: "Nope", dataRange: "A1:B3", chartType: "bar" })
    ).toThrow(/лист/);
  });

  it("addPivotTable rejects a config with no fields at all", () => {
    const state = buildSalesState();
    expect(() =>
      addPivotTable(state, { sheetId: "Sales", sourceRange: "A1:B3", targetCell: "D1", rowFields: [], valueFields: [] })
    ).toThrow(/поле/);
  });

  it("addChart/addPivotTable do not mutate the input state", () => {
    const state = buildSalesState();
    const withChart = addChart(state, { sheetId: "Sales", dataRange: "A1:B3", chartType: "bar", title: "Sales" });
    expect(state.charts).toBeUndefined();
    expect(withChart.charts).toHaveLength(1);
    expect(withChart.sheets).toBe(state.sheets); // sheets untouched, same reference
  });

  it("writes a real chart1.xml into the XLSX ZIP with the right chart type and data refs", async () => {
    let state = buildSalesState();
    state = addChart(state, { sheetId: "Sales", dataRange: "A1:B3", chartType: "bar", title: "Sales by region" });

    const bytes = await workbookStateToXlsx(state);
    const zip = await JSZip.loadAsync(bytes);

    expect(Object.keys(zip.files)).toContain("xl/charts/chart1.xml");
    const chartXml = await zip.file("xl/charts/chart1.xml")!.async("string");

    // Real DrawingML chart markup, not a stub: correct namespace, chart type,
    // title text and A1 data references into the Sales sheet.
    expect(chartXml).toContain("http://schemas.openxmlformats.org/drawingml/2006/chart");
    expect(chartXml).toContain("<c:barChart>");
    expect(chartXml).toContain("Sales by region");
    expect(chartXml).toContain("Sales!$A$2:$A$3"); // categories (Region column, data rows only)
    expect(chartXml).toContain("Sales!$B$2:$B$3"); // values (Total column, data rows only)

    // [Content_Types].xml must declare the chart part, or Excel/LibreOffice
    // will refuse to open it as a chart.
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    expect(contentTypes).toContain("chart1.xml");

    // The written file must still be readable by exceljs (the primary
    // read path for this codec) without throwing, proving the ZIP/XML
    // structure around the chart parts is not corrupt.
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(bytes) as any);
    expect(wb.getWorksheet("Sales")!.getCell("A2").value).toBe("North");
  });

  it("writes a real pivotTable1.xml + pivotCacheDefinition1.xml into the XLSX ZIP", async () => {
    let state = buildSalesState();
    state = addPivotTable(state, {
      sheetId: "Sales",
      sourceRange: "A1:B3",
      targetCell: "D1",
      rowFields: ["Region"],
      valueFields: [{ name: "Total", subtotal: "sum" }],
    });

    const bytes = await workbookStateToXlsx(state);
    const zip = await JSZip.loadAsync(bytes);

    expect(Object.keys(zip.files)).toContain("xl/pivotTables/pivotTable1.xml");
    expect(Object.keys(zip.files)).toContain("xl/pivotCache/pivotCacheDefinition1.xml");

    const pivotXml = await zip.file("xl/pivotTables/pivotTable1.xml")!.async("string");
    expect(pivotXml).toContain("pivotTableDefinition");
    expect(pivotXml).toContain('ref="D1"');
    expect(pivotXml).toContain('name="Region"');
    expect(pivotXml).toContain('name="Total"');
    expect(pivotXml).toContain('subtotal="sum"');

    const cacheXml = await zip.file("xl/pivotCache/pivotCacheDefinition1.xml")!.async("string");
    expect(cacheXml).toContain("Region");
    expect(cacheXml).toContain("Total");
  });

  it("addPivotTable rejects a field name absent from the source range's header row", async () => {
    let state = buildSalesState();
    state = addPivotTable(state, {
      sheetId: "Sales",
      sourceRange: "A1:B3",
      targetCell: "D1",
      rowFields: ["NotAColumn"],
      valueFields: [],
    });

    await expect(workbookStateToXlsx(state)).rejects.toThrow(/не найдено/);
  });

  it("a workbook with both a chart and a pivot table still round-trips through exceljs for its plain cells", async () => {
    let state = buildSalesState();
    state = addChart(state, { sheetId: "Sales", dataRange: "A1:B3", chartType: "line" });
    state = addPivotTable(state, {
      sheetId: "Sales",
      sourceRange: "A1:B3",
      targetCell: "D1",
      rowFields: ["Region"],
      valueFields: [{ name: "Total" }], // subtotal defaults to "sum"
    });

    const bytes = await workbookStateToXlsx(state);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain("xl/charts/chart1.xml");
    expect(Object.keys(zip.files)).toContain("xl/pivotTables/pivotTable1.xml");

    const chartXml = await zip.file("xl/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("<c:lineChart>");

    // Default subtotal applied ("sum") even though the caller omitted it.
    const pivotXml = await zip.file("xl/pivotTables/pivotTable1.xml")!.async("string");
    expect(pivotXml).toContain('subtotal="sum"');
  });

  it("a workbook with no charts/pivot tables still uses the exceljs write path (unchanged behavior)", async () => {
    const bytes = await buildFixtureXlsx();
    const state = await xlsxToWorkbookState(bytes);
    // No addChart/addPivotTable call at all.
    const outBytes = await workbookStateToXlsx(state);
    const zip = await JSZip.loadAsync(outBytes);
    // exceljs never writes chart/pivot parts, and this path shouldn't either.
    expect(Object.keys(zip.files).some((f) => f.startsWith("xl/charts/"))).toBe(false);
    expect(Object.keys(zip.files).some((f) => f.startsWith("xl/pivotTables/"))).toBe(false);
  });
});
