import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { addChart, addPivotTable, recalculate, workbookStateToXlsx, xlsxToWorkbookState, type WorkbookState } from "./xlsx-codec";
import { tiptapJsonToDocx } from "./docx-codec";

describe("REVIEW office preservation", () => {
  it("preserves chart and pivot definitions when recalculating cells", () => {
    let state: WorkbookState = {sheets:[{name:"Sales",rows:[[{value:"Region"},{value:"Total"}],[{value:"North"},{value:10}]]}]};
    state = addChart(state,{sheetId:"Sales",dataRange:"A1:B2",chartType:"bar"});
    state = addPivotTable(state,{sheetId:"Sales",sourceRange:"A1:B2",targetCell:"D1",rowFields:["Region"],valueFields:[{name:"Total"}]});
    const result = recalculate(state);
    expect({charts:result.charts,pivots:result.pivotTables}).toEqual({charts:state.charts,pivots:state.pivotTables});
  });
  it("preserves charts and pivot parts on second save", async () => {
    let state: WorkbookState = { sheets: [{name: "Sales", rows: [[{value:"Region"},{value:"Total"}],[{value:"North"},{value:10}],[{value:"South"},{value:20}]]}] };
    state = addChart(state, {sheetId:"Sales", dataRange:"A1:B3", chartType:"bar"});
    state = addPivotTable(state, {sheetId:"Sales", sourceRange:"A1:B3", targetCell:"D1", rowFields:["Region"], valueFields:[{name:"Total",subtotal:"sum"}]});
    const first = await workbookStateToXlsx(state);
    const original = await JSZip.loadAsync(first);
    expect(original.file("xl/charts/chart1.xml")).not.toBeNull();
    expect(original.file("xl/pivotTables/pivotTable1.xml")).not.toBeNull();
    const reopened = await xlsxToWorkbookState(Uint8Array.from(first).buffer);
    const second = await JSZip.loadAsync(await workbookStateToXlsx(reopened));
    expect({chart:!!second.file("xl/charts/chart1.xml"),pivot:!!second.file("xl/pivotTables/pivotTable1.xml")}).toEqual({chart:true,pivot:true});
  });
  it("preserves merged cells and number format on open/save", async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet("Review");
    sheet.getCell("A1").value = 123.45;
    sheet.getCell("A1").numFmt = "0.00";
    sheet.mergeCells("B2:C2");
    sheet.getCell("B2").value = "Merged";
    const bytes = await source.xlsx.writeBuffer();
    const state = await xlsxToWorkbookState(Uint8Array.from(new Uint8Array(bytes as ArrayBuffer)).buffer);
    const output = new ExcelJS.Workbook();
    await output.xlsx.load(await workbookStateToXlsx(state) as never);
    expect({format:output.worksheets[0].getCell("A1").numFmt,merged:output.worksheets[0].getCell("C2").isMerged}).toEqual({format:"0.00",merged:true});
  });
  it("exports an image node from the supported editor schema", async () => {
    const bytes = await tiptapJsonToDocx({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Image below"}]},{type:"image",attrs:{src:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",alt:"Review image"}}]});
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some(path => path.startsWith("word/media/") && !zip.files[path].dir)).toBe(true);
  });
});
