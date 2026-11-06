// @vitest-environment jsdom
//
// generateJSON (Tiptap/HTML -> ProseMirror JSON) needs a DOM to parse HTML
// into; the rest of the vitest suite runs under plain Node (see
// vitest.config.mts), so this file opts into jsdom just for itself.

import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell } from "docx";
import type { JSONContent } from "@tiptap/core";
import { docxToTiptapJson, tiptapJsonToDocx, tiptapJsonToHtml } from "./docx-codec";

/** Builds a small DOCX with a heading, bold/italic text and a 2x2 table. */
async function buildFixtureDocx(): Promise<ArrayBuffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: "Heading1", children: [new TextRun({ text: "Отчёт за квартал" })] }),
          new Paragraph({
            children: [
              new TextRun({ text: "Обычный текст, " }),
              new TextRun({ text: "жирный", bold: true }),
              new TextRun({ text: " и " }),
              new TextRun({ text: "курсив", italics: true }),
              new TextRun({ text: "." })
            ]
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun("A1")] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun("B1")] })] })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun("A2")] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun("B2")] })] })
                ]
              })
            ]
          })
        ]
      }
    ]
  });
  const buf = await Packer.toBuffer(doc);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Recursively collects every text leaf from a Tiptap JSON document. */
function collectText(node: JSONContent, out: string[] = []): string[] {
  if (node.type === "text" && typeof node.text === "string") out.push(node.text);
  for (const child of node.content ?? []) collectText(child, out);
  return out;
}

/** Top-level paragraphs only — text inside tables must not count as "outside". */
function paragraphsOutsideTables(doc: JSONContent): string[] {
  return (doc.content ?? [])
    .filter((node) => node.type === "paragraph")
    .map((node) => collectText(node).join(""));
}

/** colspan of the first cell in the second table (the merged fixture cell). */
function mergedColspan(doc: JSONContent): unknown {
  const tables = (doc.content ?? []).filter((node) => node.type === "table");
  const cell = tables[1]?.content?.[0]?.content?.[0];
  return cell?.attrs?.colspan;
}

function firstCellSpan(doc: JSONContent, name: "colspan" | "rowspan"): unknown {
  const tables = (doc.content ?? []).filter((node) => node.type === "table");
  return tables[0]?.content?.[0]?.content?.[0]?.attrs?.[name];
}

describe("docx-codec round trip", () => {
  it("parses a real DOCX (heading + formatted text + table) into Tiptap JSON", async () => {
    const bytes = await buildFixtureDocx();
    const json = await docxToTiptapJson(bytes);

    expect(json.type).toBe("doc");
    const text = collectText(json).join("");
    expect(text).toContain("Отчёт за квартал");
    expect(text).toContain("жирный");
    expect(text).toContain("курсив");
    expect(text).toContain("A1");
    expect(text).toContain("B2");

    // Bold mark actually survived mammoth -> Tiptap parsing, not just the text.
    const flat = JSON.stringify(json);
    expect(flat).toContain('"bold"');
    expect(flat).toContain('"italic"');
    // Table structure was recognized, not flattened to plain paragraphs.
    expect(flat).toContain('"table"');
  });

  it("round-trips Tiptap JSON -> DOCX -> (mammoth) HTML without losing text/table content", async () => {
    const bytes = await buildFixtureDocx();
    const json = await docxToTiptapJson(bytes);

    const outBytes = await tiptapJsonToDocx(json);
    expect(outBytes.byteLength).toBeGreaterThan(0);

    // Read the freshly-written DOCX back with mammoth (independent of our
    // own JSON parser) to prove it is a structurally valid DOCX a real
    // consumer (mammoth's XML/zip parser mirrors what Word itself expects)
    // can open, and that the content survived the second hop.
    const mammoth = await import("mammoth");
    const { value: html } = await mammoth.convertToHtml({ buffer: outBytes } as unknown as { arrayBuffer: ArrayBuffer });

    expect(html).toContain("Отчёт");
    expect(html).toContain("жирный");
    expect(html).toContain("курсив");
    expect(html).toContain("A1");
    expect(html).toContain("B2");
    // Bold formatting preserved through the full round trip.
    expect(html).toMatch(/<strong>|<b>/);
  });

  it("degrades unsupported nodes to plain paragraphs instead of throwing", async () => {
    const json: JSONContent = {
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] }]
    };
    const outBytes = await tiptapJsonToDocx(json);
    expect(outBytes.byteLength).toBeGreaterThan(0);
  });

  it("round-trips merged table cells without dropping paragraphs outside the tables", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("До таблицы")] }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      rowSpan: 2,
                      children: [new Paragraph({ children: [new TextRun("Обычная")] })]
                    }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Ячейка")] })] })
                  ]
                }),
                new TableRow({
                  children: [new TableCell({ children: [new Paragraph({ children: [new TextRun("Под")] })] })]
                })
              ]
            }),
            new Paragraph({ children: [new TextRun("Между таблицами")] }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      columnSpan: 2,
                      children: [new Paragraph({ children: [new TextRun("Широкая")] })]
                    }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun("Хвост")] })] })
                  ]
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun("A")] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun("B")] })] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun("C")] })] })
                  ]
                })
              ]
            }),
            new Paragraph({ children: [new TextRun("После таблицы")] })
          ]
        }
      ]
    });
    const buf = await Packer.toBuffer(doc);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

    const opened = await docxToTiptapJson(bytes);
    expect(paragraphsOutsideTables(opened)).toEqual(["До таблицы", "Между таблицами", "После таблицы"]);
    expect(mergedColspan(opened)).toBe(2);
    expect(firstCellSpan(opened, "rowspan")).toBe(2);

    const saved = await tiptapJsonToDocx(opened);
    const reopened = await docxToTiptapJson(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer);
    expect(paragraphsOutsideTables(reopened)).toEqual(["До таблицы", "Между таблицами", "После таблицы"]);
    expect(mergedColspan(reopened)).toBe(2);
    expect(firstCellSpan(reopened, "rowspan")).toBe(2);
    expect(collectText(reopened).join("")).toContain("Широкая");
    expect(collectText(reopened).join("")).toContain("Обычная");
  });

  it("tiptapJsonToHtml renders a JSON document back to HTML for debugging", () => {
    const html = tiptapJsonToHtml({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }]
    });
    expect(html).toContain("hello");
  });
});
