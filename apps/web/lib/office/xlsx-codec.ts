/**
 * O01 spike — XLSX <-> grid-state codec, with a real formula engine.
 *
 * Library choice (see docs/SONNET_IMPLEMENTATION/21-OFFICE-IMPLEMENTATION.md
 * O01 and 20-DOCUMENT-EDITORS.md's explicit fallback clause): Univer was the
 * default candidate, but was rejected after checking its actual npm surface
 * (see 12-PROGRESS.md O01 entry for the full trail):
 *
 *  - A working sheet UI needs `@univerjs/preset-sheets-core`, which pulls in
 *    14 separate `@univerjs/*` packages (ui, docs, docs-ui, sheets,
 *    sheets-ui, design, network, rpc, engine-render, engine-formula,
 *    sheets-formula(-ui), sheets-numfmt(-ui)) — this one package alone
 *    reports an ~9.9 MB unpacked size on the registry, before its own
 *    dependencies are counted. That is disproportionate for a lazy-loaded
 *    editor chunk in a "modular monolith for a solo developer" product.
 *  - There is no first-party Univer XLSX import/export package on npm at
 *    all (`npm search @univerjs xlsx/import/export/exchange` returns
 *    nothing official); Univer's own docs point at either a paid/hosted
 *    "Exchange" plugin or writing your own converter. Only an unofficial
 *    third-party package (`@mertdeveci55/univer-import-export`) exists,
 *    which is not something to depend on for file I/O.
 *
 * Fallback per the plan: `exceljs` (read + write XLSX, MIT, already a
 * mature/maintained library) for file I/O, plus `hyperformula` (bare, not
 * wrapped in Univer) as the actual formula engine for recalculation. The
 * documented cost: no ready-made spreadsheet *grid UI* ships with this
 * combination — O04 will need to build/adopt a plain editable grid
 * component and wire cell edits through HyperFormula itself, and native
 * charts/pivot tables are NOT SUPPORTED (exceljs can read chart XML but not
 * write full chart objects; this spike does not attempt either).
 */

import ExcelJS from "exceljs";
import { HyperFormula } from "hyperformula";

/**
 * Charts and pivot tables — added after O01 shipped the exceljs+hyperformula
 * spike (see docs/SONNET_IMPLEMENTATION/22-SPREADSHEET-CHARTS-RESEARCH.md).
 * exceljs cannot write chart/pivot XML at all (proven above, not assumed).
 *
 * Architecture decision, checked empirically before writing this file (see
 * the research doc's "Эмпирическая проверка" section and this module's own
 * spike run): `modern-xlsx` is NOT bolted on as a second writer applied on
 * top of an exceljs-produced file. That composition was considered ("exceljs
 * writes cells -> modern-xlsx opens the same bytes and injects chart/pivot
 * parts -> resave") but never actually needed, because `modern-xlsx`'s own
 * `Workbook`/`Worksheet`/`Cell` API turned out to be a full read+write XLSX
 * engine on its own (cells, formulas, styles — not just charts/pivots), not
 * a chart-only add-on. Two independent OOXML writers touching the same file
 * is exactly the kind of "conflicting structure" risk 22-... flagged, so
 * once a single-writer path was confirmed to work, it was the safer choice.
 *
 * Net result: whenever a workbook state has no charts/pivot tables, this
 * module keeps writing XLSX with exceljs exactly as O01 did (unchanged,
 * proven code path, zero new risk for the common case). Only when
 * `state.charts`/`state.pivotTables` is non-empty does `workbookStateToXlsx`
 * switch to building the file with `modern-xlsx` instead — cells, formulas,
 * charts and pivot tables all go through the *same* writer in that case, so
 * there is no cross-writer byte composition anywhere.
 *
 * `modern-xlsx@1.2.1` declares `engines.node >= 24` and its default
 * `initWasm()` does `fetch('file://...')` under the hood, which Node 22's
 * `undici` does not implement for the `file:` scheme ("fetch failed... not
 * implemented"). The documented, working alternative on Node is
 * `initWasmSync` fed the already-read `.wasm` bytes — `ensureModernXlsxWasm`
 * below does exactly that on Node, resolving the `.wasm` path next to the
 * package's own entry point (`dist/index.mjs`) rather than hardcoding a
 * `node_modules` layout, since pnpm nests packages under `.pnpm/`.
 *
 * In the browser the situation is different and was initially missed (see
 * docs/SONNET_IMPLEMENTATION/12-PROGRESS.md "O04"): there is no `node:fs`,
 * so `initWasmSync` cannot run there at all. modern-xlsx *does* ship a real
 * browser story though (its README's "Browser Usage (ESM)"/"Custom WASM
 * URL" sections, and `src/wasm-loader.ts`'s `initWasm(wasmSource)`, which
 * is a normal `fetch()` under the hood — no Node APIs). The catch is
 * `initWasm()`'s zero-argument auto-detection: it falls back to
 * `import.meta.url`, which after webpack bundles this module points at the
 * emitted JS chunk's URL, not at `node_modules` — fetching the `.wasm`
 * relative to that 404s. The fix is the documented escape hatch: pass an
 * explicit URL to `initWasm()`. `scripts/copy-modern-xlsx-wasm.mjs` copies
 * the package's `.wasm` binary into `apps/web/public/modern-xlsx.wasm`
 * (same pattern as `copy-pdf-worker.mjs` for pdf.js) before dev/build, and
 * `ensureModernXlsxWasm` fetches it from there (`/modern-xlsx.wasm`) when
 * running in a browser-like environment (`typeof window !== "undefined"`).
 */
export type ChartType = "bar" | "line" | "pie";

/** A chart inserted via the "select range, insert chart" form (no drag-and-drop canvas). */
export type ChartState = {
  /** Sheet name — this codec's grid state has no separate sheet id, only `SheetState.name`. */
  sheetId: string;
  /**
   * A1 range covering the chart's source data, header row included, e.g.
   * `"A1:B4"`. First column of the range = categories, first row = series
   * names for the remaining columns, mirroring Excel's own "select range,
   * insert chart" behavior.
   */
  dataRange: string;
  chartType: ChartType;
  title?: string;
};

export type PivotSubtotal = "sum" | "count" | "average" | "max" | "min";

/** A pivot table inserted via the "select source range + fields" form. */
export type PivotTableState = {
  /** Sheet name the source range lives on. */
  sheetId: string;
  /** A1 range covering the source data, header row included, e.g. `"A1:B3"`. */
  sourceRange: string;
  /** Top-left cell of the pivot table itself, e.g. `"D1"`. */
  targetCell: string;
  /** Header names (from `sourceRange`'s first row) to use as row fields. */
  rowFields: string[];
  /** Header names to aggregate as value fields, with an optional subtotal (defaults to "sum"). */
  valueFields: { name: string; subtotal?: PivotSubtotal }[];
};

export type CellState = {
  /** Raw value as exceljs would store it before formula evaluation. */
  value: string | number | boolean | null;
  /** Formula text without the leading "=", e.g. "SUM(A1:A2)". */
  formula?: string;
  /** exceljs/Excel number format string, e.g. "0.00" (F03). Absent = default "General". */
  numFmt?: string;
};

/** A1:D10-style merged range, as exceljs's `worksheet.mergeCells`/`model.merges` reports it (F03). */
export type MergeState = string;

export type SheetState = {
  name: string;
  /** Row-major grid; sparse rows are padded with null cells on read. */
  rows: CellState[][];
  /** Merged cell ranges on this sheet, e.g. "B2:C2" (F03). */
  merges?: MergeState[];
  /** Column widths (exceljs `column.width`, character units), 1-indexed by column number as a sparse map (F03). */
  columnWidths?: Record<number, number>;
};

export type WorkbookState = {
  sheets: SheetState[];
  /** Charts inserted via addChart. Empty/absent means "no charts" — exceljs write path stays unchanged. */
  charts?: ChartState[];
  /** Pivot tables inserted via addPivotTable. Empty/absent means the exceljs write path stays unchanged. */
  pivotTables?: PivotTableState[];
};

/** Adds a chart to workbook state (pure — returns a new state, does not mutate). */
export function addChart(state: WorkbookState, config: ChartState): WorkbookState {
  if (!state.sheets.some((s) => s.name === config.sheetId)) {
    throw new Error(`addChart: лист "${config.sheetId}" не найден`);
  }
  return { ...state, charts: [...(state.charts ?? []), config] };
}

/** Adds a pivot table to workbook state (pure — returns a new state, does not mutate). */
export function addPivotTable(state: WorkbookState, config: PivotTableState): WorkbookState {
  if (!state.sheets.some((s) => s.name === config.sheetId)) {
    throw new Error(`addPivotTable: лист "${config.sheetId}" не найден`);
  }
  if (config.rowFields.length === 0 && config.valueFields.length === 0) {
    throw new Error("addPivotTable: нужно хотя бы одно поле (rowFields или valueFields)");
  }
  return { ...state, pivotTables: [...(state.pivotTables ?? []), config] };
}

/**
 * XLSX bytes -> in-memory grid state (values + formula text, unevaluated).
 *
 * F02 fix: besides sheet cells, this also recognizes chart/pivot-table parts
 * that ORION itself wrote (via `addChart`/`addPivotTable` +
 * `workbookStateToXlsxViaModernXlsx`, i.e. `xl/charts/chartN.xml` built from
 * a single bar/line/pie series-over-a-contiguous-range shape, and
 * `xl/pivotTables/pivotTableN.xml` built from a single row/value-field
 * cache). Recognized parts round-trip losslessly through `WorkbookState`
 * (open -> save reproduces the same chart/pivot). Chart/pivot parts that do
 * NOT match this shape (e.g. authored in real Excel, with per-point
 * formatting, multiple axes, calculated fields, etc.) are deliberately left
 * out of `WorkbookState` — per 25-OFFICE-REVIEW.md F02's explicit
 * fail-closed instruction, this codec does not claim to losslessly preserve
 * arbitrary third-party OOXML chart/pivot XML. `workbookStateToXlsx` is
 * chosen (exceljs vs modern-xlsx write path) purely by whether
 * `state.charts`/`state.pivotTables` is non-empty, so a file whose charts
 * were NOT recognized here falls through to the exceljs write path, which
 * drops any chart/pivot parts exceljs itself does not understand — an
 * explicit, documented "unsupported content is not silently carried over
 * pretending to be untouched" behavior, not a lossless-preservation claim.
 */
export async function xlsxToWorkbookState(bytes: ArrayBuffer): Promise<WorkbookState> {
  const wb = new ExcelJS.Workbook();
  // exceljs's own .d.ts pins an older, stricter Buffer generic than the
  // @types/node version this repo uses elsewhere; the runtime call is a
  // plain Buffer either way.
  // exceljs bundles its own, older @types/node whose Buffer type is
  // nominally distinct from this project's; only a full `any` escape
  // satisfies both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(bytes) as any);

  const sheets: SheetState[] = wb.worksheets.map((ws) => {
    const rows: CellState[][] = [];
    const colCount = ws.columnCount || 1;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: CellState[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        const numFmt = cell.numFmt && cell.numFmt !== "General" ? cell.numFmt : undefined;
        if (cell.formula) {
          cells.push({ value: typeof cell.result === "object" ? null : ((cell.result as string | number | boolean) ?? null), formula: cell.formula, numFmt });
        } else if (cell.value && typeof cell.value === "object" && "formula" in (cell.value as object)) {
          const f = cell.value as { formula: string; result?: unknown };
          cells.push({ value: (f.result as string | number | boolean) ?? null, formula: f.formula, numFmt });
        } else {
          const v = cell.value;
          cells.push({ value: v === undefined || v === null ? null : (v as string | number | boolean), numFmt });
        }
      }
      rows.push(cells);
    }

    // F03: merged ranges. exceljs exposes the merge model as
    // `{ "A1:B2": "A1:B2", ... }` keyed by the same range string.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mergeModel = (ws.model as any)?.merges as string[] | undefined;
    const merges = mergeModel && mergeModel.length ? [...mergeModel] : undefined;

    // F03: column widths, sparse by 1-indexed column number.
    const columnWidths: Record<number, number> = {};
    ws.columns?.forEach((col, idx) => {
      if (col && typeof col.width === "number") columnWidths[idx + 1] = col.width;
    });

    return {
      name: ws.name,
      rows,
      merges,
      columnWidths: Object.keys(columnWidths).length ? columnWidths : undefined
    };
  });

  const { charts, pivotTables } = await readOrionChartsAndPivots(bytes, sheets);

  return {
    sheets: sheets.length ? sheets : [{ name: "Sheet1", rows: [[{ value: null }]] }],
    charts,
    pivotTables
  };
}

/**
 * Best-effort recognition of ORION-authored chart/pivot parts on reopen
 * (F02). exceljs does not expose chart/pivot XML through its own API at
 * all, so this re-reads the raw zip parts directly from `bytes` (the same
 * JSZip already used by this module's own tests) rather than trying to
 * route through exceljs's model.
 *
 * Only parts that exactly match the shape `workbookStateToXlsxViaModernXlsx`
 * itself writes are recognized:
 *  - chart: a single `<c:barChart>`/`<c:lineChart>`/`<c:pieChart>` with one
 *    or more `<c:ser>` series sharing one category reference, all on one
 *    sheet (mirrors `addChart`'s "select range, insert chart" shape).
 *  - pivot table: a single pivot cache with one source range and row/data
 *    fields addressed by name (mirrors `addPivotTable`'s shape).
 * Anything else (multi-axis charts, scatter/combo charts, calculated
 * fields, filters, per-point formatting, ...) is left unrecognized and
 * simply does not appear in the returned `WorkbookState` — see the
 * fail-closed note on `xlsxToWorkbookState` above for why that is
 * deliberate rather than a bug to "improve" by guessing.
 */
async function readOrionChartsAndPivots(
  bytes: ArrayBuffer,
  sheets: SheetState[]
): Promise<{ charts?: ChartState[]; pivotTables?: PivotTableState[] }> {
  const JSZip = (await import("jszip")).default;
  let zip: import("jszip");
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return {};
  }

  const sheetNameByRelIndex = sheets.map((s) => s.name);
  const charts: ChartState[] = [];
  const pivotTables: PivotTableState[] = [];

  // Map each worksheet to the chart parts it embeds via
  // xl/worksheets/_rels/sheetN.xml.rels -> xl/drawings/drawingN.xml ->
  // xl/drawings/_rels/drawingN.xml.rels -> xl/charts/chartN.xml. This is the
  // exact chain `modern-xlsx` produces for a single addChart() call.
  for (let sheetIdx = 0; sheetIdx < sheetNameByRelIndex.length; sheetIdx++) {
    const sheetFile = sheetIdx + 1;
    const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetFile}.xml.rels`;
    const sheetRelsXml = await zip.file(sheetRelsPath)?.async("text");
    if (!sheetRelsXml) continue;
    const drawingMatch = /Target="\.\.\/drawings\/(drawing\d+\.xml)"/.exec(sheetRelsXml);
    if (!drawingMatch) continue;
    const drawingName = drawingMatch[1];
    const drawingRelsXml = await zip.file(`xl/drawings/_rels/${drawingName}.rels`)?.async("text");
    if (!drawingRelsXml) continue;
    const chartMatch = /Target="\.\.\/charts\/(chart\d+\.xml)"/.exec(drawingRelsXml);
    if (!chartMatch) continue;
    const chartXml = await zip.file(`xl/charts/${chartMatch[1]}`)?.async("text");
    if (!chartXml) continue;
    const parsed = parseOrionChartXml(chartXml, sheetNameByRelIndex[sheetIdx]);
    if (parsed) charts.push(parsed);
  }

  // Pivot tables: xl/pivotTables/pivotTableN.xml (+ its cache definition for
  // the source range) — same recognized-shape rule as charts.
  const pivotFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(p))
    .sort();
  for (const pivotPath of pivotFiles) {
    const pivotXml = await zip.file(pivotPath)?.async("text");
    if (!pivotXml) continue;
    const cacheIdMatch = /cacheId="(\d+)"/.exec(pivotXml);
    if (!cacheIdMatch) continue;
    const cacheFiles = Object.keys(zip.files).filter((p) => /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(p));
    let sourceSheet: string | undefined;
    let sourceRef: string | undefined;
    for (const cacheFile of cacheFiles) {
      const cacheXml = await zip.file(cacheFile)?.async("text");
      if (!cacheXml) continue;
      const wsSourceTag = /<worksheetSource\b[^>]*\/?>/.exec(cacheXml)?.[0];
      const sheetAttr = wsSourceTag ? xmlAttr(wsSourceTag, "sheet") : undefined;
      const refAttr = wsSourceTag ? xmlAttr(wsSourceTag, "ref") : undefined;
      if (sheetAttr && refAttr) {
        sourceSheet = sheetAttr;
        sourceRef = refAttr;
        break;
      }
    }
    if (!sourceSheet || !sourceRef) continue;
    const sheet = sheets.find((s) => s.name === sourceSheet);
    if (!sheet) continue;
    const rangeMatch = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(sourceRef);
    if (!rangeMatch) continue;
    const startCol = columnLettersToIndex(rangeMatch[1]) - 1;
    const endCol = columnLettersToIndex(rangeMatch[3]) - 1;
    const headerRowIdx = Number(rangeMatch[2]) - 1;
    const headerRow = sheet.rows[headerRowIdx] ?? [];
    const headerNames: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const v = headerRow[c]?.value;
      headerNames.push(v == null ? "" : String(v));
    }
    const parsed = parseOrionPivotXml(pivotXml, sourceSheet, sourceRef, headerNames);
    if (parsed) pivotTables.push(parsed);
  }

  return {
    charts: charts.length ? charts : undefined,
    pivotTables: pivotTables.length ? pivotTables : undefined
  };
}

function xmlAttr(tag: string, attr: string): string | undefined {
  const m = new RegExp(`${attr}="([^"]*)"`).exec(tag);
  return m?.[1];
}

/** Recognizes the single-shape chart XML `workbookStateToXlsxViaModernXlsx` writes; returns undefined otherwise. */
function parseOrionChartXml(xml: string, sheetName: string): ChartState | undefined {
  let chartType: ChartType | undefined;
  if (xml.includes("<c:barChart>") || xml.includes("<c:barChart ")) chartType = "bar";
  else if (xml.includes("<c:lineChart>") || xml.includes("<c:lineChart ")) chartType = "line";
  else if (xml.includes("<c:pieChart>") || xml.includes("<c:pieChart ")) chartType = "pie";
  if (!chartType) return undefined;

  // Per series (`<c:ser>...</c:ser>`), the category ref lives inside
  // `<c:cat>...<c:f>REF</c:f>...</c:cat>` and the value ref inside
  // `<c:val>...<c:f>REF</c:f>...</c:val>` — the `<c:tx>` series-name ref
  // (a literal string like "Total", not a cell range) is deliberately not
  // read here.
  const seriesXmls = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]);
  if (seriesXmls.length === 0) return undefined;
  let catRef: string | undefined;
  const valueRefs: string[] = [];
  for (const ser of seriesXmls) {
    const cat = /<c:cat>[\s\S]*?<c:f>([^<]+)<\/c:f>/.exec(ser)?.[1];
    const val = /<c:val>[\s\S]*?<c:f>([^<]+)<\/c:f>/.exec(ser)?.[1];
    if (cat && !catRef) catRef = cat;
    if (val) valueRefs.push(val);
  }
  if (!catRef || valueRefs.length === 0) return undefined;

  const rangeFromRefs = combineChartRange(catRef, valueRefs, sheetName);
  if (!rangeFromRefs) return undefined;

  const titleMatch = /<c:title>[\s\S]*?<a:t>([^<]*)<\/a:t>/.exec(xml);
  return { sheetId: sheetName, dataRange: rangeFromRefs, chartType, title: titleMatch?.[1] || undefined };
}

/** Reconstructs the original "A1:B4"-style data range from a category ref + value refs, one row up (header row). */
function combineChartRange(catRef: string, valueRefs: string[], sheetName: string): string | undefined {
  const stripSheet = (ref: string): string => ref.replace(new RegExp(`^${sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}!`), "").replace(/\$/g, "");
  const catLocal = stripSheet(catRef);
  const catMatch = /^([A-Za-z]+)(\d+):[A-Za-z]+(\d+)$/.exec(catLocal);
  if (!catMatch) return undefined;
  const [, catCol, firstDataRowStr, lastDataRowStr] = catMatch;
  const headerRow = Number(firstDataRowStr) - 1;
  if (headerRow < 1) return undefined;

  let maxCol = catCol;
  for (const ref of valueRefs) {
    const local = stripSheet(ref);
    const m = /^([A-Za-z]+)\d+:([A-Za-z]+)\d+$/.exec(local);
    if (!m) return undefined;
    if (columnLettersToIndex(m[2]) > columnLettersToIndex(maxCol)) maxCol = m[2];
  }
  return `${catCol}${headerRow}:${maxCol}${lastDataRowStr}`;
}

function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Recognizes the single-shape pivot XML `workbookStateToXlsxViaModernXlsx` writes; returns undefined otherwise. */
function parseOrionPivotXml(xml: string, sourceSheet: string, sourceRef: string, headerNames: string[]): PivotTableState | undefined {
  const locationMatch = /<location ref="([^"]+)"/.exec(xml);
  if (!locationMatch) return undefined;
  const targetCell = locationMatch[1].split(":")[0];

  // Field order matches the source range's header columns left-to-right —
  // the same assumption `workbookStateToXlsxViaModernXlsx` relies on when it
  // builds the cache from `fieldNames`, so `headerNames[idx]` (resolved by
  // the caller from the live sheet cells) recovers the original field name.
  const fieldsBlock = /<pivotFields[^>]*>([\s\S]*?)<\/pivotFields>/.exec(xml)?.[1] ?? "";
  const fieldTags = [...fieldsBlock.matchAll(/<pivotField[^>]*axis="([^"]*)"[^/]*\/?>/g)];
  const rowFields: string[] = [];
  fieldTags.forEach((m, idx) => {
    if (m[1] === "axisRow" && headerNames[idx]) rowFields.push(headerNames[idx]);
  });

  const dataFieldsBlock = /<dataFields[^>]*>([\s\S]*?)<\/dataFields>/.exec(xml)?.[1] ?? "";
  const dataFieldTags = [...dataFieldsBlock.matchAll(/<dataField[^>]*\/>/g)].map((m) => m[0]);
  if (rowFields.length === 0 && dataFieldTags.length === 0) return undefined;

  const subtotalFromFn = (fn?: string): PivotSubtotal => {
    switch (fn) {
      case "count":
        return "count";
      case "average":
        return "average";
      case "max":
        return "max";
      case "min":
        return "min";
      default:
        return "sum";
    }
  };

  const valueFields: { name: string; subtotal?: PivotSubtotal }[] = [];
  for (const tag of dataFieldTags) {
    const fldIdx = Number(xmlAttr(tag, "fld") ?? "-1");
    const name = headerNames[fldIdx];
    if (!name) return undefined;
    valueFields.push({ name, subtotal: subtotalFromFn(xmlAttr(tag, "subtotal")) });
  }

  if (rowFields.length === 0 && valueFields.length === 0) return undefined;

  return { sheetId: sourceSheet, sourceRange: sourceRef, targetCell, rowFields, valueFields };
}

/** In-memory grid state -> valid XLSX bytes (formulas written as formulas). */
export async function workbookStateToXlsx(state: WorkbookState): Promise<Buffer> {
  if ((state.charts && state.charts.length > 0) || (state.pivotTables && state.pivotTables.length > 0)) {
    return workbookStateToXlsxViaModernXlsx(state);
  }
  const wb = new ExcelJS.Workbook();
  for (const sheet of state.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    sheet.rows.forEach((row, rIdx) => {
      row.forEach((cell, cIdx) => {
        const excelCell = ws.getCell(rIdx + 1, cIdx + 1);
        if (cell.formula) {
          excelCell.value = { formula: cell.formula, result: cell.value ?? undefined } as ExcelJS.CellFormulaValue;
        } else {
          excelCell.value = cell.value;
        }
        if (cell.numFmt) excelCell.numFmt = cell.numFmt;
      });
    });
    // F03: merges and column widths.
    for (const range of sheet.merges ?? []) {
      ws.mergeCells(range);
    }
    if (sheet.columnWidths) {
      for (const [colNum, width] of Object.entries(sheet.columnWidths)) {
        ws.getColumn(Number(colNum)).width = width;
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Lazily initializes modern-xlsx's WASM module exactly once per process.
 * See the module-level comment above for the Node-vs-browser split: Node
 * uses `initWasmSync` fed bytes read via `node:fs` (works down to Node 22,
 * unlike the package's default `initWasm()`); the browser has no `node:fs`
 * at all, so it uses `initWasm()` with an explicit URL to the `.wasm` file
 * copied into `public/` by `scripts/copy-modern-xlsx-wasm.mjs`, which fetches
 * it like any other static asset.
 */
let modernXlsxWasmInit: Promise<void> | null = null;
async function ensureModernXlsxWasm(): Promise<void> {
  if (!modernXlsxWasmInit) {
    modernXlsxWasmInit = (async () => {
      const mod = await import("modern-xlsx");
      if (typeof window !== "undefined") {
        // Browser (or jsdom test environment): no node:fs. Fetch the .wasm
        // binary from public/ instead — see module-level comment.
        await mod.initWasm("/modern-xlsx.wasm");
        return;
      }
      const { createRequire } = await import("node:module");
      const fs = await import("node:fs");
      const path = await import("node:path");
      // Resolve the .wasm file next to modern-xlsx's own entry point rather
      // than assuming a flat node_modules layout — pnpm nests the package
      // under node_modules/.pnpm/modern-xlsx@<version>/node_modules/.
      const req = createRequire(import.meta.url);
      const entryPoint = req.resolve("modern-xlsx");
      const wasmPath = path.join(path.dirname(entryPoint), "modern-xlsx.wasm");
      mod.initWasmSync(fs.readFileSync(wasmPath));
    })();
  }
  return modernXlsxWasmInit;
}

/** A1 cell reference like "$B$3" for a single column/row pair (0-based row/col in). */
function a1Cell(colLetterToLetter: (c: number) => string, col: number, row: number): string {
  return `$${colLetterToLetter(col)}$${row + 1}`;
}

/**
 * In-memory grid state -> valid XLSX bytes, written entirely through
 * `modern-xlsx` (cells, formulas, charts and pivot tables all go through
 * this one writer — see the architecture note at the top of this file for
 * why this is not composed with the exceljs writer above).
 */
async function workbookStateToXlsxViaModernXlsx(state: WorkbookState): Promise<Buffer> {
  await ensureModernXlsxWasm();
  const mx = await import("modern-xlsx");

  const wb = new mx.Workbook();
  // R28-04: this writer used to carry over cell values/formulas only, unlike
  // the exceljs branch above (F03) which also writes numFmt/merges/column
  // widths — so a workbook with a chart or pivot table (the only thing that
  // routes here, see `workbookStateToXlsx`) silently lost every cell's
  // number format and every merged range on save, even though the exceljs
  // branch preserves the exact same metadata for a chart-less workbook.
  // `Cell.numberFormat` is read-only on modern-xlsx's API (no setter) —
  // setting a format goes through `StyleBuilder().numberFormat(code).build(wb.styles)`
  // to get a style index, then `cell.styleIndex = idx` (documented pattern
  // in the package's own `StyleBuilder.build` example). Merges and column
  // widths DO have direct setters (`Worksheet.addMergeCell`/`setColumnWidth`),
  // symmetric with the exceljs branch's `ws.mergeCells`/`column.width`.
  const numFmtStyleIndex = new Map<string, number>();
  const styleIndexFor = (numFmt: string): number => {
    const cached = numFmtStyleIndex.get(numFmt);
    if (cached !== undefined) return cached;
    const idx = new mx.StyleBuilder().numberFormat(numFmt).build(wb.styles);
    numFmtStyleIndex.set(numFmt, idx);
    return idx;
  };
  for (const sheet of state.sheets) {
    const ws = wb.addSheet(sheet.name);
    sheet.rows.forEach((row, rIdx) => {
      row.forEach((cell, cIdx) => {
        const ref = mx.encodeCellRef(rIdx, cIdx);
        const mxCell = ws.cell(ref);
        if (cell.formula) {
          mxCell.formula = cell.formula;
          if (cell.value !== null && cell.value !== undefined) mxCell.value = cell.value;
        } else {
          mxCell.value = cell.value;
        }
        if (cell.numFmt) mxCell.styleIndex = styleIndexFor(cell.numFmt);
      });
    });
    // Same F03 metadata as the exceljs branch: merges and column widths.
    for (const range of sheet.merges ?? []) {
      ws.addMergeCell(range);
    }
    if (sheet.columnWidths) {
      for (const [colNum, width] of Object.entries(sheet.columnWidths)) {
        ws.setColumnWidth(Number(colNum), width);
      }
    }
  }

  (state.charts ?? []).forEach((chart) => {
    const ws = wb.getSheet(chart.sheetId);
    if (!ws) throw new Error(`workbookStateToXlsx: лист "${chart.sheetId}" не найден для диаграммы`);
    const range = mx.decodeRange(chart.dataRange);
    const catCol = range.start.col;
    const firstDataRow = range.start.row + 1; // row 0 of the range is the header
    if (firstDataRow > range.end.row) {
      throw new Error(`addChart: диапазон "${chart.dataRange}" не содержит строк данных под заголовком`);
    }
    const catRef = `${chart.sheetId}!${a1Cell(mx.columnToLetter, catCol, firstDataRow)}:${a1Cell(mx.columnToLetter, catCol, range.end.row)}`;
    ws.addChart(chart.chartType, (b) => {
      if (chart.title) b.title(chart.title);
      for (let col = range.start.col + 1; col <= range.end.col; col++) {
        const headerCell = state.sheets.find((s) => s.name === chart.sheetId)?.rows[range.start.row]?.[col];
        const seriesName = headerCell?.value != null ? String(headerCell.value) : undefined;
        const valRef = `${chart.sheetId}!${a1Cell(mx.columnToLetter, col, firstDataRow)}:${a1Cell(mx.columnToLetter, col, range.end.row)}`;
        b.addSeries({ name: seriesName, catRef, valRef });
      }
    });
  });

  (state.pivotTables ?? []).forEach((pivot, pivotIdx) => {
    const sourceSheet = state.sheets.find((s) => s.name === pivot.sheetId);
    if (!sourceSheet) throw new Error(`workbookStateToXlsx: лист "${pivot.sheetId}" не найден для сводной таблицы`);
    const range = mx.decodeRange(pivot.sourceRange);
    const headerRow = sourceSheet.rows[range.start.row] ?? [];
    const fieldNames: string[] = [];
    for (let col = range.start.col; col <= range.end.col; col++) {
      const headerCell = headerRow[col];
      fieldNames.push(headerCell?.value != null ? String(headerCell.value) : mx.columnToLetter(col));
    }
    const fieldIndex = (name: string): number => {
      const idx = fieldNames.indexOf(name);
      if (idx === -1) {
        throw new Error(`addPivotTable: поле "${name}" не найдено среди заголовков ${pivot.sourceRange} (${fieldNames.join(", ")})`);
      }
      return idx;
    };

    // decodeRange gives 0-based indices; the cache source ref is relative to
    // the sheet, without the sheet name (mirrors modern-xlsx's own example).
    const sourceRef = `${mx.columnToLetter(range.start.col)}${range.start.row + 1}:${mx.columnToLetter(range.end.col)}${range.end.row + 1}`;
    wb.addPivotCache({
      source: { sheet: pivot.sheetId, ref: sourceRef },
      fields: fieldNames.map((name) => ({ name })),
    });

    const targetSheet = wb.getSheet(pivot.sheetId)!;
    targetSheet.addPivotTableFromBuilder((b) => {
      b.name(`Pivot${pivotIdx + 1}`).cacheId(pivotIdx).location(pivot.targetCell);
      for (const name of pivot.rowFields) {
        b.addRowField({ fieldIndex: fieldIndex(name), name });
      }
      for (const field of pivot.valueFields) {
        b.addDataField({ fieldIndex: fieldIndex(field.name), subtotal: field.subtotal ?? "sum", name: field.name });
      }
    });
  });

  const bytes = await wb.toBuffer();
  return Buffer.from(bytes);
}

/**
 * Recalculates every formula in a workbook state using HyperFormula (the
 * real formula engine, not a value we trust from the file) and returns a
 * new state with `value` set to the computed result for every formula
 * cell. Proves formulas — including cross-sheet references — actually
 * evaluate, not just "survive as text" through the round trip.
 */
export function recalculate(state: WorkbookState): WorkbookState {
  // Known HyperFormula limitation found while building this spike: its
  // formula tokenizer only accepts bare (unquoted) sheet-name references
  // when the name is ASCII — `Данные!A1` fails to parse ("unexpected
  // character: ->Д<-"), while `'Данные'!A1` (quoted, exactly like Excel
  // quotes names containing spaces/special characters) parses fine. Excel
  // itself does NOT require quoting for a plain Cyrillic sheet name, so a
  // file authored in real Excel with e.g. `=Данные!A1` would come back
  // from exceljs unquoted and fail here. We normalize by quoting any bare
  // reference to a sheet name that HyperFormula would otherwise choke on
  // (non-ASCII or containing a space) before handing formulas to the
  // engine. This is a workaround, not a fix — flagged for O02/O03 as a
  // real compatibility gap to keep validating against more fixtures.
  const needsQuoting = (name: string) => /[^ -~]/.test(name) || /\s/.test(name);
  const quotedNames = state.sheets.filter((s) => needsQuoting(s.name)).map((s) => s.name);
  const normalizeFormula = (formula: string): string => {
    let out = formula;
    for (const name of quotedNames) {
      // Note: cannot use \b here — \b is defined in terms of the ASCII
      // \w class, which does not include Cyrillic letters, so it never
      // matches around a Cyrillic sheet name. Matching on the literal
      // name directly (not preceded by a quote) is sufficient here.
      const bare = new RegExp(`(?<!')${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}!`, "g");
      out = out.replace(bare, `'${name}'!`);
    }
    return out;
  };

  const sheetData = state.sheets.map((s) =>
    s.rows.map((row) => row.map((cell) => (cell.formula ? `=${normalizeFormula(cell.formula)}` : cell.value)))
  );
  const hf = HyperFormula.buildFromSheets(
    Object.fromEntries(state.sheets.map((s, i) => [s.name, sheetData[i]])),
    { licenseKey: "gpl-v3" }
  );

  const sheets: SheetState[] = state.sheets.map((sheet) => {
    const sheetId = hf.getSheetId(sheet.name)!;
    const rows = sheet.rows.map((row, rIdx) =>
      row.map((cell, cIdx) => {
        if (!cell.formula) return cell;
        const result = hf.getCellValue({ sheet: sheetId, row: rIdx, col: cIdx });
        return { ...cell, value: result as CellState["value"] };
      })
    );
    return { name: sheet.name, rows, merges: sheet.merges, columnWidths: sheet.columnWidths };
  });

  hf.destroy();
  // F01: recalculation only touches formula *values* — it must never drop
  // charts/pivotTables (or merges/column widths) from the workbook. Before
  // this fix, `recalculate` returned `{ sheets }` only, so `xlsx-editor.tsx`
  // calling `recalculate` after every cell edit silently stripped any
  // chart/pivot inserted earlier in the same session, before the user ever
  // got to Save.
  return { sheets, charts: state.charts, pivotTables: state.pivotTables };
}
