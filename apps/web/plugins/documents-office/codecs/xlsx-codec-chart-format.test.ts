import {it,expect} from "vitest";
import ExcelJS from "exceljs";
import {addChart,workbookStateToXlsx,type WorkbookState} from "./xlsx-codec";
it("REVIEW chart writer preserves number formats and merges too",async()=>{
  const source:WorkbookState={sheets:[{name:"Sales",rows:[[{value:"Region"},{value:"Total"}],[{value:"North"},{value:12.3,numFmt:"0.00"}],[{value:null},{value:null},{value:"Merged"}]],merges:["C3:D3"],columnWidths:[20,25]}]};
  const state=addChart(source,{sheetId:"Sales",dataRange:"A1:B2",chartType:"bar"});
  const wb=new ExcelJS.Workbook();
  await wb.xlsx.load(await workbookStateToXlsx(state) as never);
  expect({format:wb.worksheets[0].getCell("B2").numFmt,merge:wb.worksheets[0].getCell("D3").isMerged}).toEqual({format:"0.00",merge:true});
});
