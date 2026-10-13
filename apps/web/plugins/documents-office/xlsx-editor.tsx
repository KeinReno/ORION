"use client";

/**
 * O04 — native XLSX editor tab. `React.lazy`-loaded (see `OfficeEditor.tsx`),
 * so exceljs/HyperFormula/modern-xlsx only land in a chunk fetched when an
 * XLSX is actually opened.
 *
 * Deliberately NOT a full Excel clone (per 21-OFFICE-IMPLEMENTATION.md /
 * task instructions): a plain editable grid over `WorkbookState`
 * (`apps/web/plugins/documents-office/codecs/xlsx-codec.ts`, O01/O01b), sheet tabs, computed
 * formula values via `recalculate` (HyperFormula), and minimal "insert
 * chart" / "insert pivot table" forms driving the already-existing
 * `addChart`/`addPivotTable` — no drag-and-drop, no cell-range selection UI
 * (range/target are typed as A1 text, same pattern as the chart form).
 * Pivot-table field pickers read header names from the source range's first
 * row and pass them straight to `addPivotTable`, which already addresses
 * fields by header name (see 12-PROGRESS.md "O05" for the session that added
 * this — the O04 session shipped only the chart form).
 *
 * O04 originally shipped with a browser limitation: `workbookStateToXlsx`'s
 * `modern-xlsx` write path (needed for charts/pivots) read its `.wasm` file
 * via `node:fs` — Node-only, so saving a sheet with a chart failed in the
 * browser/WebView. Fixed in the O04-follow-up session:
 * `ensureModernXlsxWasm` now branches to modern-xlsx's own browser-native
 * `initWasm("/modern-xlsx.wasm")` (plain `fetch()`, no Node APIs) when
 * `typeof window !== "undefined"`, fetching the `.wasm` copy
 * `scripts/copy-modern-xlsx-wasm.mjs` places in `public/` before dev/build.
 * See `xlsx-codec.ts`'s module-level comment and 12-PROGRESS.md
 * "O04-follow-up" for the full trail. The save handler below still catches
 * and surfaces any failure as a clear Russian error rather than a silent/
 * half-written file, per 21-OFFICE-IMPLEMENTATION.md's "ошибка сохранения"
 * contract — that defense-in-depth stays regardless of this fix.
 */

import { useReplaceDocumentContent } from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { AutosaveStatus, Button, Input, Select, Spinner, cx, useToast } from "@orion/ui";
import { BarChart3, Plus, Save, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addChart,
  addPivotTable,
  recalculate,
  workbookStateToXlsx,
  xlsxToWorkbookState,
  type ChartType,
  type PivotSubtotal,
  type WorkbookState
} from "./codecs/xlsx-codec";
import { shouldAcceptRefetchedBlob } from "./codecs/editor-generation-guard";
import { XLSX_MIME } from "./codecs/office-files";

/** Parses an A1 range like "A1:D10" into header names read from its first row. */
function headersFromRange(sheetRows: { value: string | number | boolean | null; formula?: string }[][], range: string): string[] {
  const match = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(range.trim());
  if (!match) return [];
  const colToIndex = (letters: string): number => {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const [, colA, rowAStr] = match;
  const colBLetters = match[3];
  const startCol = colToIndex(colA);
  const endCol = colToIndex(colBLetters);
  const headerRowIdx = Number(rowAStr) - 1;
  const row = sheetRows[headerRowIdx];
  if (!row) return [];
  const headers: string[] = [];
  for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
    const v = row[c]?.value;
    headers.push(v === null || v === undefined ? "" : String(v));
  }
  return headers.filter((h) => h.trim() !== "");
}

export interface OfficeEditorInnerProps {
  workspaceId: string;
  doc: DocumentItem;
  blob: Blob;
  onParseFailed: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

const MAX_DISPLAY_ROWS = 200;
const MAX_DISPLAY_COLS = 40;

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export default function XlsxEditor({ workspaceId, doc, blob, onParseFailed, onDirtyChange }: OfficeEditorInnerProps): React.ReactElement {
  const { toast } = useToast();
  const replaceContent = useReplaceDocumentContent(workspaceId);
  const [state, setState] = useState<WorkbookState | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const [activeSheet, setActiveSheet] = useState(0);
  // F05: edit-generation / saved-generation guard. `editGeneration` bumps on
  // every user edit (cell, chart, pivot). `save()` snapshots it into
  // `savedGenerationRef` right before it sends bytes to the server. The
  // `blob` effect below (which fires both on first open AND whenever
  // react-query refetches/invalidates the document blob — including right
  // after our own successful save) only applies the parsed content when
  // `editGeneration === savedGenerationRef.current`, i.e. nothing was typed
  // since that save was kicked off. If the user kept editing while the
  // save request was in flight, the refetched blob is stale relative to
  // their newer edits and must NOT silently overwrite them.
  const editGenerationRef = useRef(0);
  const savedGenerationRef = useRef(0);
  function bumpEditGeneration(): void {
    editGenerationRef.current += 1;
  }
  const [chartOpen, setChartOpen] = useState(false);
  const [chartRange, setChartRange] = useState("A1:B4");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [chartTitle, setChartTitle] = useState("");

  const [pivotOpen, setPivotOpen] = useState(false);
  const [pivotRange, setPivotRange] = useState("A1:B4");
  const [pivotTarget, setPivotTarget] = useState("D1");
  const [pivotRowFields, setPivotRowFields] = useState<Set<string>>(new Set());
  const [pivotValueFields, setPivotValueFields] = useState<Record<string, PivotSubtotal | undefined>>({});

  useEffect(() => {
    let alive = true;
    // F05/R28-05: this effect re-fires on first open AND on every subsequent
    // react-query refetch/invalidation of `blob` (e.g. immediately after
    // this editor's own successful save, or another tab/window's save).
    // The original guard snapshotted `editGenerationRef.current` at the
    // start of THIS effect run (`generationAtFetchStart`) and only rejected
    // the blob if generation changed WHILE this particular parse was in
    // flight. That misses a draft that was already dirty BEFORE the effect
    // started (send A, type B, then the save-response/refetch fires this
    // effect — `generationAtFetchStart` already equals the post-B
    // generation, so the check trivially passes and B gets silently
    // replaced by server content for A). The right check is against
    // `savedGenerationRef` — the generation as of the last successful
    // save — not a value captured mid-flight: any unsaved edit, from
    // before or during this fetch, must block the blob.
    blob
      .arrayBuffer()
      .then((bytes) => xlsxToWorkbookState(bytes))
      .then((parsed) => {
        if (!alive) return;
        if (!shouldAcceptRefetchedBlob(editGenerationRef.current, savedGenerationRef.current)) {
          // There is an unsaved edit (from before or during this fetch) —
          // keep the draft, do not overwrite it with server content that
          // may now be stale relative to it.
          return;
        }
        setState(parsed);
        setActiveSheet(0);
        setDirty(false);
        savedGenerationRef.current = editGenerationRef.current;
      })
      .catch(() => {
        if (alive) onParseFailed();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  // F05: warn on tab close/reload while there is unsaved input — same
  // pattern as `panels/note-editor.tsx`'s S11 guard. This editor has no
  // `onClose` callback of its own (it lives inside `DocumentsPanel`'s
  // preview pane, switched by selecting another document in the tree, not
  // by a dedicated close button), so only the beforeunload half of that
  // pattern applies here; switching the selected document while dirty is a
  // known, separate gap (see 12-PROGRESS.md).
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent): void {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const pivotHeaders = useMemo(
    () => (state ? headersFromRange(state.sheets[activeSheet]?.rows ?? [], pivotRange) : []),
    [state, activeSheet, pivotRange]
  );

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const sheet = state.sheets[activeSheet];
  const rowCount = Math.min(Math.max(sheet.rows.length + 5, 20), MAX_DISPLAY_ROWS);
  const colCount = Math.min(
    Math.max(sheet.rows.reduce((m, r) => Math.max(m, r.length), 0) + 3, 10),
    MAX_DISPLAY_COLS
  );

  function cellAt(rowIdx: number, colIdx: number): { value: string | number | boolean | null; formula?: string } {
    return sheet.rows[rowIdx]?.[colIdx] ?? { value: null };
  }

  function setCell(rowIdx: number, colIdx: number, raw: string): void {
    setState((cur) => {
      if (!cur) return cur;
      const next: WorkbookState = { ...cur, sheets: cur.sheets.map((s) => ({ ...s, rows: s.rows.map((r) => [...r]) })) };
      const s = next.sheets[activeSheet];
      while (s.rows.length <= rowIdx) s.rows.push([]);
      const row = s.rows[rowIdx];
      while (row.length <= colIdx) row.push({ value: null });

      if (raw.startsWith("=")) {
        row[colIdx] = { value: null, formula: raw.slice(1) };
      } else if (raw.trim() === "") {
        row[colIdx] = { value: null };
      } else {
        const num = Number(raw);
        row[colIdx] = { value: Number.isFinite(num) && raw.trim() !== "" ? num : raw };
      }
      return recalculate(next);
    });
    setDirty(true);
    bumpEditGeneration();
  }

  function insertChart(): void {
    if (!chartRange.trim()) return;
    setState((cur) => {
      if (!cur) return cur;
      try {
        return addChart(cur, {
          sheetId: sheet.name,
          dataRange: chartRange.trim(),
          chartType,
          title: chartTitle.trim() || undefined
        });
      } catch (e) {
        toast({ title: "Не удалось добавить диаграмму", description: (e as Error).message, tone: "danger" });
        return cur;
      }
    });
    setDirty(true);
    bumpEditGeneration();
    setChartOpen(false);
    setChartRange("A1:B4");
    setChartTitle("");
  }

  function insertPivotTable(): void {
    if (!pivotRange.trim() || !pivotTarget.trim()) return;
    const rowFields = Array.from(pivotRowFields);
    const valueFields = Object.keys(pivotValueFields).map((name) => ({ name, subtotal: pivotValueFields[name] }));
    if (rowFields.length === 0 && valueFields.length === 0) {
      toast({ title: "Не удалось добавить сводную таблицу", description: "Выберите хотя бы одно поле.", tone: "danger" });
      return;
    }
    setState((cur) => {
      if (!cur) return cur;
      try {
        return addPivotTable(cur, {
          sheetId: sheet.name,
          sourceRange: pivotRange.trim(),
          targetCell: pivotTarget.trim(),
          rowFields,
          valueFields
        });
      } catch (e) {
        toast({ title: "Не удалось добавить сводную таблицу", description: (e as Error).message, tone: "danger" });
        return cur;
      }
    });
    setDirty(true);
    bumpEditGeneration();
    setPivotOpen(false);
    setPivotRange("A1:B4");
    setPivotTarget("D1");
    setPivotRowFields(new Set());
    setPivotValueFields({});
  }

  function togglePivotRowField(name: string): void {
    setPivotRowFields((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function togglePivotValueField(name: string): void {
    setPivotValueFields((cur) => {
      const next = { ...cur };
      if (name in next) delete next[name];
      else next[name] = "sum";
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!state) return;
    // F05: snapshot the generation being saved BEFORE the (possibly slow)
    // serialize+upload, so the blob-reload effect above knows whether it is
    // safe to apply the refetched content once this save's invalidation
    // triggers a refetch (see that effect's comment).
    const generationBeingSaved = editGenerationRef.current;
    try {
      const bytes = await workbookStateToXlsx(state);
      const file = new File([bytes as unknown as BlobPart], doc.name, { type: XLSX_MIME });
      await replaceContent.mutateAsync({ id: doc.id, file });
      savedGenerationRef.current = generationBeingSaved;
      // Only clear dirty if nothing was typed while this save was in
      // flight — if the user kept editing, the just-saved bytes are
      // already behind their draft, so the editor must stay dirty (and a
      // fresh Save is still needed) rather than falsely showing "сохранено".
      if (editGenerationRef.current === generationBeingSaved) {
        setDirty(false);
        toast({ title: "Сохранено", tone: "success" });
      } else {
        toast({ title: "Сохранено (есть новые несохранённые изменения)", tone: "success" });
      }
    } catch (e) {
      toast({
        title: "Не удалось сохранить",
        description: (e as Error).message || "Диаграммы/сводные таблицы пока не сохраняются в браузере — см. 12-PROGRESS.md.",
        tone: "danger"
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => setChartOpen((v) => !v)}>
          <BarChart3 className="h-4 w-4" /> Вставить диаграмму
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPivotOpen((v) => !v)}>
          <Table2 className="h-4 w-4" /> Вставить сводную таблицу
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <AutosaveStatus state={replaceContent.isPending ? "saving" : replaceContent.isError ? "error" : dirty ? "dirty" : "saved"} />
          <Button size="sm" onClick={() => void save()} status={replaceContent.isPending ? "pending" : "idle"}>
            <Save className="h-4 w-4" /> Сохранить
          </Button>
        </div>
      </div>

      {chartOpen ? (
        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-border bg-card px-3 py-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Диапазон (с заголовком)
            <Input value={chartRange} onChange={(e) => setChartRange(e.target.value)} placeholder="A1:B4" className="w-32" />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Тип
            <Select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
              <option value="bar">Столбчатая</option>
              <option value="line">Линейная</option>
              <option value="pie">Круговая</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Заголовок (опционально)
            <Input value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} className="w-40" />
          </label>
          <Button size="sm" onClick={insertChart}>
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        </div>
      ) : null}

      {pivotOpen ? (
        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-border bg-card px-3 py-2">
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Исходный диапазон (с заголовком)
            <Input value={pivotRange} onChange={(e) => setPivotRange(e.target.value)} placeholder="A1:D10" className="w-32" />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-subtle-foreground">
            Ячейка вставки
            <Input value={pivotTarget} onChange={(e) => setPivotTarget(e.target.value)} placeholder="F1" className="w-20" />
          </label>
          {pivotHeaders.length > 0 ? (
            <>
              <div className="flex flex-col gap-1 text-2xs text-subtle-foreground">
                Поля строк
                <div className="flex flex-wrap gap-2">
                  {pivotHeaders.map((h) => (
                    <label key={h} className="flex items-center gap-1 text-xs text-foreground">
                      <input type="checkbox" checked={pivotRowFields.has(h)} onChange={() => togglePivotRowField(h)} />
                      {h}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1 text-2xs text-subtle-foreground">
                Поля значений
                <div className="flex flex-wrap gap-2">
                  {pivotHeaders.map((h) => (
                    <label key={h} className="flex items-center gap-1 text-xs text-foreground">
                      <input type="checkbox" checked={h in pivotValueFields} onChange={() => togglePivotValueField(h)} />
                      {h}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <span className="text-2xs text-subtle-foreground">Укажите диапазон с заголовком в первой строке, чтобы выбрать поля.</span>
          )}
          <Button size="sm" onClick={insertPivotTable}>
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        </div>
      ) : null}

      {state.sheets.length > 1 ? (
        <div className="orion-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {state.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              className={cx(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                i === activeSheet ? "bg-accent/15 text-accent-text" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="orion-scroll min-h-0 flex-1 overflow-auto p-3">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-10 border border-border bg-card" />
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={c} className="sticky top-0 z-10 border border-border bg-card px-2 py-1 text-center font-normal text-subtle-foreground">
                  {colLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, r) => (
              <tr key={r}>
                <td className="sticky left-0 border border-border bg-card px-2 py-1 text-right text-subtle-foreground">{r + 1}</td>
                {Array.from({ length: colCount }).map((_, c) => {
                  const cell = cellAt(r, c);
                  const editValue = cell.formula ? `=${cell.formula}` : (cell.value ?? "");
                  return (
                    <td key={c} className="border border-border p-0">
                      <input
                        defaultValue={String(editValue)}
                        key={`${r}-${c}-${dirty ? "d" : "c"}`}
                        onBlur={(e) => {
                          if (e.target.value !== String(editValue)) setCell(r, c, e.target.value);
                        }}
                        className="w-20 bg-transparent px-2 py-1 text-foreground outline-none focus:bg-accent/[0.08]"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
