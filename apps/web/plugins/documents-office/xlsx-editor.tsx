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
import {
  EXCEL_MAX_ROWS, EXCEL_MAX_COLS, addWorksheet, applyGridChanges, cellAddress,
  cellDisplayText, cellInputText, changeGridStructure, changesForClear, clipboardChanges, columnLabel,
  parseCellAddress, rangeToTsv, renameWorksheet, setCellNumberFormat,
  type GridChange, type GridRange, type GridStructureAction
} from "./xlsx-grid-operations";
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

const VISIBLE_ROWS = 60;
const VISIBLE_COLS = 16;

type PendingCell = { sheetIndex: number; row: number; col: number; value: string };

export default function XlsxEditor({ workspaceId, doc, blob, onParseFailed, onDirtyChange }: OfficeEditorInnerProps): React.ReactElement {
  const { toast } = useToast();
  const replaceContent = useReplaceDocumentContent(workspaceId);
  const [state, setState] = useState<WorkbookState | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const [activeSheet, setActiveSheet] = useState(0);
  const stateRef = useRef<WorkbookState | null>(null);
  const initialLoadRef = useRef(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingCell = useRef<PendingCell | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState({ row: 0, col: 0 });
  const [range, setRange] = useState<GridRange | null>(null);
  const [firstRow, setFirstRow] = useState(0);
  const [firstCol, setFirstCol] = useState(0);
  const [addressText, setAddressText] = useState("A1");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
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
        stateRef.current = parsed;
        pendingCell.current = null;
        setDraft(null);
        setState(parsed);
        if (initialLoadRef.current) {
          setActiveSheet(0);
          setSelected({ row: 0, col: 0 });
          setRange(null);
          setFirstRow(0);
          setFirstCol(0);
          setAddressText("A1");
          initialLoadRef.current = false;
        } else {
          // Refetch after Save must not throw the user back to sheet 1 / A1.
          setActiveSheet((index) => Math.min(index, parsed.sheets.length - 1));
        }
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
  const rowCount = Math.min(VISIBLE_ROWS, EXCEL_MAX_ROWS - firstRow);
  const colCount = Math.min(VISIBLE_COLS, EXCEL_MAX_COLS - firstCol);

  function cellAt(row: number, col: number) {
    return sheet.rows[row]?.[col];
  }

  function applyChanges(sheetIndex: number, changes: readonly GridChange[]): void {
    if (changes.length === 0 || !stateRef.current) return;
    try {
      const next = recalculate(applyGridChanges(stateRef.current, sheetIndex, changes));
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
    } catch (error) {
      toast({ title: "Не удалось изменить таблицу", description: (error as Error).message, tone: "danger" });
    }
  }

  function commitDraft(): void {
    const pending = pendingCell.current;
    if (!pending) return;
    pendingCell.current = null;
    setDraft(null);
    const before = stateRef.current?.sheets[pending.sheetIndex]?.rows[pending.row]?.[pending.col];
    if (cellInputText(before) !== pending.value) {
      applyChanges(pending.sheetIndex, [{ row: pending.row, col: pending.col, text: pending.value }]);
    }
  }

  function startEdit(row: number, col: number): void {
    const value = cellInputText(cellAt(row, col));
    pendingCell.current = { sheetIndex: activeSheet, row, col, value };
    setSelected({ row, col });
    setRange(null);
    setAddressText(cellAddress(row, col));
    setDraft(value);
  }

  function changeDraft(value: string, row: number, col: number): void {
    // After Enter/Ctrl+S the focus may remain in an input whose previous draft
    // was committed. A subsequent keystroke must start a new draft, not vanish.
    if (!pendingCell.current) {
      pendingCell.current = { sheetIndex: activeSheet, row, col, value };
    } else {
      pendingCell.current.value = value;
    }
    setDraft(value);
  }

  function goTo(row: number, col: number): void {
    if (row < 0 || col < 0 || row >= EXCEL_MAX_ROWS || col >= EXCEL_MAX_COLS) return;
    commitDraft();
    setSelected({ row, col });
    setRange(null);
    setAddressText(cellAddress(row, col));
    if (row < firstRow || row >= firstRow + VISIBLE_ROWS) setFirstRow(Math.floor(row / VISIBLE_ROWS) * VISIBLE_ROWS);
    if (col < firstCol || col >= firstCol + VISIBLE_COLS) setFirstCol(Math.floor(col / VISIBLE_COLS) * VISIBLE_COLS);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLInputElement>('[data-cell="' + cellAddress(row, col) + '"]')?.focus();
    });
  }

  function jumpToAddress(): void {
    const position = parseCellAddress(addressText);
    if (!position) {
      toast({ title: "Неверный адрес ячейки", description: "Используйте формат A1, B27 или AA350.", tone: "danger" });
      return;
    }
    goTo(position.row, position.col);
  }

  function pasteRange(row: number, col: number, text: string): void {
    // The clipboard replaces the selected anchor cell; do not save a stale draft over it.
    pendingCell.current = null;
    setDraft(null);
    setRange(null);
    try {
      applyChanges(activeSheet, clipboardChanges(text, row, col));
    } catch (error) {
      toast({ title: "Не удалось вставить диапазон", description: (error as Error).message, tone: "danger" });
    }
  }

  function currentRange(): GridRange {
    return range ?? {
      startRow: selected.row, endRow: selected.row,
      startCol: selected.col, endCol: selected.col
    };
  }

  function clearRange(): void {
    commitDraft();
    try {
      applyChanges(activeSheet, changesForClear(currentRange()));
      setRange(null);
    } catch (error) {
      toast({ title: "Не удалось очистить диапазон", description: (error as Error).message, tone: "danger" });
    }
  }

  async function copyRange(): Promise<void> {
    commitDraft();
    if (!stateRef.current) return;
    try {
      const content = rangeToTsv(stateRef.current, activeSheet, currentRange());
      if (!navigator.clipboard?.writeText) throw new Error("Буфер обмена недоступен; выделите диапазон и нажмите Ctrl+C.");
      await navigator.clipboard.writeText(content);
      toast({ title: "Диапазон скопирован", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось скопировать", description: (error as Error).message, tone: "danger" });
    }
  }

  function editStructure(action: GridStructureAction): void {
    commitDraft();
    if (!stateRef.current) return;
    try {
      const next = changeGridStructure(stateRef.current, activeSheet, action, selected.row, selected.col);
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
    } catch (error) {
      toast({ title: "Не удалось изменить структуру листа", description: (error as Error).message, tone: "danger" });
    }
  }

  function setSelectedNumberFormat(format: string): void {
    commitDraft();
    if (!stateRef.current) return;
    try {
      const next = setCellNumberFormat(stateRef.current, activeSheet, selected.row, selected.col, format);
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
    } catch (error) {
      toast({ title: "Не удалось изменить формат", description: (error as Error).message, tone: "danger" });
    }
  }

  function createSheet(): void {
    commitDraft();
    if (!stateRef.current) return;
    const next = addWorksheet(stateRef.current);
    stateRef.current = next;
    setState(next);
    setActiveSheet(next.sheets.length - 1);
    setSelected({ row: 0, col: 0 });
    setRange(null);
    setAddressText("A1");
    setFirstRow(0);
    setFirstCol(0);
    setDirty(true);
    bumpEditGeneration();
  }

  function applyRename(): void {
    commitDraft();
    if (!stateRef.current) return;
    try {
      const next = recalculate(renameWorksheet(stateRef.current, activeSheet, renameName));
      if (next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
      setRenameOpen(false);
    } catch (error) {
      toast({ title: "Не удалось переименовать лист", description: (error as Error).message, tone: "danger" });
    }
  }

  function insertChart(): void {
    if (!chartRange.trim()) return;
    commitDraft();
    if (!stateRef.current) return;
    try {
      const next = addChart(stateRef.current, {
        sheetId: stateRef.current.sheets[activeSheet].name,
        dataRange: chartRange.trim(),
        chartType,
        title: chartTitle.trim() || undefined
      });
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
      setChartOpen(false);
      setChartRange("A1:B4");
      setChartTitle("");
    } catch (error) {
      toast({ title: "Не удалось добавить диаграмму", description: (error as Error).message, tone: "danger" });
    }
  }

  function insertPivotTable(): void {
    if (!pivotRange.trim() || !pivotTarget.trim()) return;
    const rowFields = Array.from(pivotRowFields);
    const valueFields = Object.keys(pivotValueFields).map((name) => ({ name, subtotal: pivotValueFields[name] }));
    if (rowFields.length === 0 && valueFields.length === 0) {
      toast({ title: "Не удалось добавить сводную таблицу", description: "Выберите хотя бы одно поле.", tone: "danger" });
      return;
    }
    commitDraft();
    if (!stateRef.current) return;
    try {
      const next = addPivotTable(stateRef.current, {
        sheetId: stateRef.current.sheets[activeSheet].name,
        sourceRange: pivotRange.trim(),
        targetCell: pivotTarget.trim(),
        rowFields,
        valueFields
      });
      stateRef.current = next;
      setState(next);
      setDirty(true);
      bumpEditGeneration();
      setPivotOpen(false);
      setPivotRange("A1:B4");
      setPivotTarget("D1");
      setPivotRowFields(new Set());
      setPivotValueFields({});
    } catch (error) {
      toast({ title: "Не удалось добавить сводную таблицу", description: (error as Error).message, tone: "danger" });
    }
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
    if (replaceContent.isPending) return;
    commitDraft();
    const snapshot = stateRef.current;
    if (!snapshot) return;
    // F05: snapshot the generation being saved BEFORE the (possibly slow)
    // serialize+upload, so the blob-reload effect above knows whether it is
    // safe to apply the refetched content once this save's invalidation
    // triggers a refetch (see that effect's comment).
    const generationBeingSaved = editGenerationRef.current;
    try {
      const bytes = await workbookStateToXlsx(snapshot);
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

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Input
          aria-label="Адрес ячейки"
          value={addressText}
          onChange={(event) => setAddressText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); jumpToAddress(); }
          }}
          className="w-24"
        />
        <Button size="sm" variant="outline" onClick={jumpToAddress}>Перейти</Button>
        <Input
          aria-label="Значение или формула выбранной ячейки"
          value={
            pendingCell.current?.sheetIndex === activeSheet &&
            pendingCell.current.row === selected.row &&
            pendingCell.current.col === selected.col && draft !== null
              ? draft : cellInputText(cellAt(selected.row, selected.col))
          }
          onFocus={() => startEdit(selected.row, selected.col)}
          onChange={(event) => changeDraft(event.target.value, selected.row, selected.col)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commitDraft(); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
              event.preventDefault(); void save();
            }
          }}
          className="min-w-48 flex-1 font-mono"
          placeholder="Значение или =SUM(A1:A5)"
        />
        <span className="text-2xs text-subtle-foreground">Enter / Tab — следующая ячейка · вставка из Excel поддерживается</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="orion-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {state.sheets.map((tab, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                commitDraft();
                setActiveSheet(index);
                setSelected({ row: 0, col: 0 });
                setRange(null);
                setAddressText("A1");
                setFirstRow(0); setFirstCol(0);
                setRenameOpen(false);
              }}
              className={cx(
                "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                index === activeSheet ? "bg-accent/15 text-accent-text" : "text-muted-foreground hover:text-foreground"
              )}
              aria-pressed={index === activeSheet}
            >
              {tab.name}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={createSheet}>+ Лист</Button>
        <Button size="sm" variant="outline" onClick={() => {
          setRenameName(sheet.name); setRenameOpen((current) => !current);
        }}>Переименовать</Button>
      </div>

      {renameOpen ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <Input
            aria-label="Новое имя листа"
            value={renameName}
            maxLength={31}
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); applyRename(); }
              if (event.key === "Escape") setRenameOpen(false);
            }}
            className="max-w-xs"
          />
          <Button size="sm" onClick={applyRename}>Применить</Button>
          <Button size="sm" variant="outline" onClick={() => setRenameOpen(false)}>Отмена</Button>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Button size="sm" variant="outline" onClick={() => setFirstRow((row) => Math.max(0, row - VISIBLE_ROWS))} disabled={firstRow === 0}>← Строки</Button>
        <Button size="sm" variant="outline" onClick={() => setFirstRow((row) => Math.min(EXCEL_MAX_ROWS - VISIBLE_ROWS, row + VISIBLE_ROWS))} disabled={firstRow + VISIBLE_ROWS >= EXCEL_MAX_ROWS}>Строки →</Button>
        <Button size="sm" variant="outline" onClick={() => setFirstCol((col) => Math.max(0, col - VISIBLE_COLS))} disabled={firstCol === 0}>← Столбцы</Button>
        <Button size="sm" variant="outline" onClick={() => setFirstCol((col) => Math.min(EXCEL_MAX_COLS - VISIBLE_COLS, col + VISIBLE_COLS))} disabled={firstCol + VISIBLE_COLS >= EXCEL_MAX_COLS}>Столбцы →</Button>
        <span className="text-2xs text-subtle-foreground">
          Строки {firstRow + 1}–{firstRow + rowCount} · Столбцы {columnLabel(firstCol)}–{columnLabel(firstCol + colCount - 1)}
        </span>
        <Button size="sm" variant="outline" onClick={() => void copyRange()}>Копировать</Button>
        <Button size="sm" variant="outline" onClick={clearRange}>Очистить</Button>
        {range ? <span className="text-2xs text-accent-text">Выделено {cellAddress(range.startRow, range.startCol)}:{cellAddress(range.endRow, range.endCol)}</span> : null}
      </div>


      <details className="shrink-0 border-b border-border">
        <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Структура листа и форматирование ячейки
        </summary>
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          <Button size="sm" variant="outline" onClick={() => editStructure("insert-row")}>Вставить строку</Button>
          <Button size="sm" variant="outline" onClick={() => editStructure("delete-row")}>Удалить строку</Button>
          <Button size="sm" variant="outline" onClick={() => editStructure("insert-column")}>Вставить столбец</Button>
          <Button size="sm" variant="outline" onClick={() => editStructure("delete-column")}>Удалить столбец</Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Формат
            <Select
              aria-label="Формат числа выбранной ячейки"
              value={cellAt(selected.row, selected.col)?.numFmt ?? "General"}
              onChange={(event) => setSelectedNumberFormat(event.target.value)}
            >
              {["General", "0", "#,##0.00", "0%", "yyyy-mm-dd"].includes(cellAt(selected.row, selected.col)?.numFmt ?? "General") ? null : (
                <option value={cellAt(selected.row, selected.col)?.numFmt}>Пользовательский</option>
              )}
              <option value="General">Общий</option>
              <option value="0">Целое число</option>
              <option value="#,##0.00">Число (2 знака)</option>
              <option value="0%">Процент</option>
              <option value="yyyy-mm-dd">Дата</option>
            </Select>
          </label>
          <span className="text-2xs text-subtle-foreground">Структурные операции защищены от повреждения формул и объединений.</span>
        </div>
      </details>

      <div ref={gridRef} className="orion-scroll min-h-0 flex-1 overflow-auto p-3">
        <table className="border-collapse text-xs" aria-label="Редактируемая таблица">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-10 border border-border bg-card" />
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={firstCol + c} className="sticky top-0 z-10 border border-border bg-card px-2 py-1 text-center font-normal text-subtle-foreground">
                  {columnLabel(firstCol + c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, r) => {
              const row = firstRow + r;
              return (
                <tr key={row}>
                  <td className="sticky left-0 border border-border bg-card px-2 py-1 text-right text-subtle-foreground">{row + 1}</td>
                  {Array.from({ length: colCount }).map((_, c) => {
                    const col = firstCol + c;
                    const address = cellAddress(row, col);
                    const cell = cellAt(row, col);
                    const editing = pendingCell.current?.sheetIndex === activeSheet &&
                      pendingCell.current.row === row && pendingCell.current.col === col && draft !== null;
                    return (
                      <td key={col} className="border border-border p-0">
                        <input
                          type="text"
                          data-cell={address}
                          aria-label={"Ячейка " + address}
                          value={editing ? (draft ?? "") : cellDisplayText(cell)}
                          onMouseDown={(event) => {
                            if (event.shiftKey) {
                              event.preventDefault();
                              setRange({
                                startRow: selected.row, startCol: selected.col,
                                endRow: row, endCol: col
                              });
                            } else setRange(null);
                          }}
                          onFocus={() => startEdit(row, col)}
                          onChange={(event) => changeDraft(event.target.value, row, col)}
                          onBlur={commitDraft}
                          onCopy={(event) => {
                            if (!range || !stateRef.current) return;
                            event.preventDefault();
                            commitDraft();
                            if (stateRef.current) {
                              event.clipboardData.setData("text/plain", rangeToTsv(stateRef.current, activeSheet, range));
                            }
                          }}
                          onPaste={(event) => {
                            const text = event.clipboardData.getData("text/plain");
                            if (text.includes("\t") || text.includes("\n") || text.includes("\r")) {
                              event.preventDefault();
                              pasteRange(row, col, text);
                            }
                          }}
                          onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                              event.preventDefault(); void save(); return;
                            }
                            if (event.key === "Escape") {
                              pendingCell.current = null; setDraft(null); setRange(null); event.currentTarget.blur(); return;
                            }
                            if (event.key === "Delete" && range) {
                              event.preventDefault(); clearRange(); return;
                            }
                            if (event.key === "Enter" || event.key === "Tab") {
                              event.preventDefault();
                              commitDraft();
                              goTo(
                                row + (event.key === "Enter" ? (event.shiftKey ? -1 : 1) : 0),
                                col + (event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0)
                              );
                            }
                          }}
                          className={cx(
                            "w-28 bg-transparent px-2 py-1 text-foreground outline-none focus:bg-accent/[0.08]",
                            selected.row === row && selected.col === col ? "bg-accent/10 ring-1 ring-inset ring-accent" : "",
                            range && row >= Math.min(range.startRow, range.endRow) && row <= Math.max(range.startRow, range.endRow) &&
                              col >= Math.min(range.startCol, range.endCol) && col <= Math.max(range.startCol, range.endCol)
                                ? "bg-accent/20 ring-1 ring-inset ring-accent/70" : ""
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
