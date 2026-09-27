// @vitest-environment jsdom
/**
 * Proves the browser WASM-init path of modern-xlsx actually works, not just
 * "doesn't throw at import time". `ensureModernXlsxWasm` in xlsx-codec.ts
 * branches on `typeof window !== "undefined"` and calls
 * `modern-xlsx`'s `initWasm("/modern-xlsx.wasm")`, which does a plain
 * `fetch()` — no `node:fs`. This test runs under jsdom (so `window` exists,
 * exercising the same branch a real browser would) and stubs `global.fetch`
 * to serve the real `.wasm` bytes from node_modules for that one URL,
 * proving the whole chart-insertion pipeline produces a structurally valid
 * chart1.xml when initialized this way — the same assertions O01b's
 * Node-path test makes, run through the browser init path instead.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { addChart, workbookStateToXlsx, type WorkbookState } from "./xlsx-codec";

const require_ = createRequire(import.meta.url);
const wasmPath = join(dirname(require_.resolve("modern-xlsx")), "modern-xlsx.wasm");
const wasmBytes = readFileSync(wasmPath);

const originalFetch = global.fetch;

beforeAll(() => {
  // Only intercept the exact URL ensureModernXlsxWasm requests; anything
  // else falls through to the real fetch (there shouldn't be any in this
  // test, but this keeps the stub honest rather than a blanket catch-all).
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("modern-xlsx.wasm")) {
      return new Response(wasmBytes, { status: 200, headers: { "content-type": "application/wasm" } });
    }
    if (!originalFetch) throw new Error(`unexpected fetch in test: ${url}`);
    return originalFetch(input);
  }) as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

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

describe("xlsx-codec chart insertion via the browser WASM-init path (jsdom + fetch stub)", () => {
  it("initializes modern-xlsx through fetch('/modern-xlsx.wasm') and writes a real chart1.xml", async () => {
    expect(typeof window).not.toBe("undefined"); // sanity: we're actually exercising the browser branch

    let state = buildSalesState();
    state = addChart(state, { sheetId: "Sales", dataRange: "A1:B3", chartType: "bar", title: "Sales by region" });

    const bytes = await workbookStateToXlsx(state);
    expect(global.fetch).toHaveBeenCalledWith("/modern-xlsx.wasm");

    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain("xl/charts/chart1.xml");

    const chartXml = await zip.file("xl/charts/chart1.xml")!.async("string");
    expect(chartXml).toContain("http://schemas.openxmlformats.org/drawingml/2006/chart");
    expect(chartXml).toContain("<c:barChart>");
    expect(chartXml).toContain("Sales by region");
    expect(chartXml).toContain("Sales!$A$2:$A$3");
    expect(chartXml).toContain("Sales!$B$2:$B$3");

    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    expect(contentTypes).toContain("chart1.xml");

    // Readable back with exceljs — proves the file isn't merely present but structurally sound.
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(bytes) as any);
    expect(wb.getWorksheet("Sales")!.getCell("A2").value).toBe("North");
  });
});
