import { describe, expect, it } from "vitest";
import { docxToTiptapJson, tiptapJsonToDocx } from "./docx-codec";
import { recalculate, workbookStateToXlsx, xlsxToWorkbookState, type WorkbookState } from "./xlsx-codec";

describe("QA-05: real DOCX/XLSX codecs preserve unrelated content", () => {
  it("QA-05-01: multi-sheet XLSX edit preserves other cells, formula, merge and number format", async () => {
    const original: WorkbookState = {
      sheets: [
        {
          name: "Исходные",
          merges: ["A1:B1"],
          columnWidths: { 1: 22 },
          rows: [
            [{ value: "Заголовок" }, { value: null }, { value: "Не изменять" }],
            [{ value: 10, numFmt: "0.00" }, { value: 20 }, { value: "Строка" }],
            [{ value: null, formula: "SUM(A2:B2)" }, { value: "Контроль" }]
          ]
        },
        {
          name: "Формулы",
          rows: [[{ value: null, formula: "Исходные!A3*2" }, { value: "Посторонние данные" }]]
        }
      ]
    };
    // Round-trip through actual XLSX bytes, not a mocked in-memory workbook.
    const first = await xlsxToWorkbookState(await workbookStateToXlsx(recalculate(original)));
    expect(first.sheets.map(s => s.name)).toEqual(["Исходные", "Формулы"]);
    expect(first.sheets[0]!.merges).toContain("A1:B1");
    expect(first.sheets[0]!.rows[1]![0]!.numFmt).toBe("0.00");
    expect(first.sheets[1]!.rows[0]![0]!.formula).toBe("Исходные!A3*2");

    const edited: WorkbookState = JSON.parse(JSON.stringify(first));
    edited.sheets[0]!.rows[1]![0]!.value = 100;
    const second = recalculate(await xlsxToWorkbookState(await workbookStateToXlsx(recalculate(edited))));
    expect(second.sheets[0]!.rows[1]![0]!.value).toBe(100);
    expect(second.sheets[0]!.rows[1]![1]!.value).toBe(20);
    expect(second.sheets[0]!.rows[0]![2]!.value).toBe("Не изменять");
    expect(second.sheets[0]!.rows[2]![1]!.value).toBe("Контроль");
    expect(second.sheets[0]!.merges).toContain("A1:B1");
    expect(second.sheets[0]!.rows[1]![0]!.numFmt).toBe("0.00");
    expect(second.sheets[0]!.rows[2]![0]!.value).toBe(120);
    expect(second.sheets[1]!.rows[0]![0]!.value).toBe(240);
    expect(second.sheets[1]!.rows[0]![1]!.value).toBe("Посторонние данные");
    expect(original.sheets[0]!.rows[1]![0]!.value).toBe(10);
  });

  it("QA-05-02 RED CONTRACT: DOCX merged cell survives a save-open cycle alongside other tables and paragraphs", async () => {
    const paragraph = (text: string) => ({
      type: "paragraph",
      content: [{ type: "text", text }]
    });
    const cell = (text: string, colspan = 1) => ({
      type: "tableCell",
      attrs: { colspan, rowspan: 1, colwidth: null },
      content: [paragraph(text)]
    });
    const original = {
      type: "doc",
      content: [
        paragraph("Вступительный текст"),
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("A1"), cell("B1")] },
            { type: "tableRow", content: [cell("A2"), cell("B2")] }
          ]
        },
        paragraph("Текст между таблицами"),
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("Объединённая ячейка", 2)] },
            { type: "tableRow", content: [cell("C2"), cell("D2")] }
          ]
        },
        paragraph("Заключение")
      ]
    };
    const parsed = await docxToTiptapJson(await tiptapJsonToDocx(original));
    const text = JSON.stringify(parsed);
    for (const value of [
      "Вступительный текст", "Текст между таблицами",
      "Заключение", "A1", "B2", "Объединённая ячейка", "C2", "D2"
    ]) {
      expect(text).toContain(value);
    }
    const tables = (parsed.content ?? []).filter(node => node.type === "table");
    expect(tables).toHaveLength(2);
    const merged = tables[1]?.content?.[0]?.content?.[0];
    expect(merged?.attrs?.colspan).toBe(2);
  });
});
