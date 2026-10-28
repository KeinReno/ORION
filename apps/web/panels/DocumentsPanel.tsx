"use client";

import { useCore } from "@orion/core-react";
import {
  useBulkDocuments,
  useCreateFolder,
  useDeleteDocument,
  useDocuments,
  usePurgeDocument,
  useRenameOrMoveDocument,
  useReplaceDocumentContent,
  useRestoreDocument,
  useUploadDocuments
} from "@orion/core-react";
import type { DocumentItem, DocumentView } from "@orion/shared-types";
import {
  Button,
  CallChip,
  ConfirmDialog,
  TypeToConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Sheet,
  Skeleton,
  cx,
  isTypingTarget,
  useContextMenuApi,
  useDebouncedValue,
  usePanelVisible,
  useResizeWidth,
  useToast,
  type CallChipStatus,
  type MenuItem
} from "@orion/ui";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Download,
  FolderPlus,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOC_GROUP_LABEL, documentGroup, documentIcon, formatBytes, type DocGroup } from "../lib/document-icons";
import { relativeTime } from "../lib/format";
import { FilterChip } from "../components/filter-chip";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { nextListId } from "../lib/list-nav";
import { DocThumbnail } from "./documents/thumbnail";
import type { DocumentCreateAction } from "../lib/extensions/contracts";
import { ExtensionSlot, useSlotContributions } from "../lib/extensions/slot";
import { PreviewPane } from "./documents/preview-pane";
import { useDocumentFocusRequest } from "../lib/panel-bus";
import { useUnsavedDraft } from "../lib/unsaved-drafts";
import { useViewState } from "../lib/use-view-state";
import { documentsViewStateSchema } from "@orion/shared-types";

type SortKey = "name" | "date" | "size" | "type";
type Layout = "list" | "grid";
const TWO_PANE_MIN = 760;

export function DocumentsPanel(): React.ReactElement {
  const panelVisible = usePanelVisible();
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { api } = useCore();
  const { toast } = useToast();
  // ORION-07: right-click on a row — same items as its "⋯" menu (docMenuItems below).
  const showContextMenu = useContextMenuApi();

  const [view, setView] = useState<DocumentView>("active");
  const trash = view === "trash";
  const { data: docs, isLoading } = useDocuments(workspaceId, view);

  const createFolder = useCreateFolder(workspaceId);
  const uploadDocs = useUploadDocuments(workspaceId);
  const renameOrMove = useRenameOrMoveDocument(workspaceId);
  const deleteDoc = useDeleteDocument(workspaceId);
  const restoreDoc = useRestoreDocument(workspaceId);
  const purgeDoc = usePurgeDocument(workspaceId);
  const bulk = useBulkDocuments(workspaceId);
  const replaceContent = useReplaceDocumentContent(workspaceId);

  const [wrapRef, width] = useResizeWidth<HTMLDivElement>();
  const twoPane = width >= TWO_PANE_MIN;
  const compactList = twoPane || width < 600;
  const compactActions = width < 740;

  const [cwd, setCwd] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const selectedFileIdRef = useRef<string | null>(null);
  selectedFileIdRef.current = selectedFileId;
  const [editorDirty, setEditorDirty] = useState(false);
  // The local file-switch dialog protects the preview. Register the same
  // draft with the shell so a workspace switch cannot unmount it silently.
  useUnsavedDraft(editorDirty);
  const editorDirtyRef = useRef(false);
  editorDirtyRef.current = editorDirty;
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const guardNavigation = useCallback((next: () => void) => {
    if (editorDirtyRef.current) setPendingNavigation(() => next);
    else next();
  }, []);
  const selectFile = useCallback((id: string | null) => {
    if (selectedFileIdRef.current === id) return;
    guardNavigation(() => {
      selectedFileIdRef.current = id;
      setSelectedFileId(id);
      setEditorDirty(false);
    });
  }, [guardNavigation]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  // U02: "связанные записи" elsewhere (a task/note/transaction) jump here via
  // focusDocument(id) (apps/web/lib/panel-bus.ts) — open its preview Sheet the
  // same way a row click does, not a second navigation mechanism.
  // `documentFocusRequest` (not its id) in the deps: a fresh nonce on every focusDocument() call is
  // what lets focusing the same document a second time in a row keep opening it instead of no-oping.
  const documentFocusRequest = useDocumentFocusRequest();
  useEffect(() => {
    if (documentFocusRequest) selectFile(documentFocusRequest.id);
  }, [documentFocusRequest, selectFile]);
  const [sort, setSort] = useState<SortKey>("name");
  const [layout, setLayout] = useState<Layout>("list");
  const [groupFilter, setGroupFilter] = useState<DocGroup | null>(null);
  // Folder, open file, view, sort and layout survive a restart. Ids are only addresses: one that is
  // gone (or no longer visible to this user) is dropped with a plain explanation, never shown.
  const appliedView = useRef(view); // the view whose transient selection is current; a restored view must not reset it
  const restoredView = useViewState("documents", documentsViewStateSchema, workspaceId,
    { view, cwd, selectedFileId, sort, layout },
    (saved) => {
      appliedView.current = saved.view; setView(saved.view); setSort(saved.sort); setLayout(saved.layout); setCwd(saved.cwd);
      if (saved.selectedFileId) { selectedFileIdRef.current = saved.selectedFileId; setSelectedFileId(saved.selectedFileId); }
    });
  const staleChecked = useRef(false);
  useEffect(() => {
    if (staleChecked.current || !restoredView || !docs || isLoading) return;
    staleChecked.current = true;
    const missingFolder = restoredView.cwd !== null && !docs.some((d) => d.id === restoredView.cwd);
    const missingFile = restoredView.selectedFileId !== null && !docs.some((d) => d.id === restoredView.selectedFileId);
    if (missingFolder) setCwd(null);
    if (missingFile) { selectedFileIdRef.current = null; setSelectedFileId(null); }
    if (missingFolder || missingFile) toast({ title: "Прежнее место недоступно", description: "Папка или файл удалены, перемещены или у вас больше нет доступа." });
  }, [restoredView, docs, isLoading, toast]);
  const [uploadChips, setUploadChips] = useState<
    { id: string; label: string; sublabel?: string; status: CallChipStatus; files: File[]; parentId: string | null }[]
  >([]);
  const [dragOver, setDragOver] = useState(false);
  const reducedMotion = useReducedMotion();

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveTargets, setMoveTargets] = useState<string[] | null>(null);
  const [pendingPurge, setPendingPurge] = useState<{ ids: string[]; label: string } | null>(null);
  const [pendingBulkMove, setPendingBulkMove] = useState<{ ids: string[]; parentId: string | null } | null>(null);
  const [historyTarget, setHistoryTarget] = useState<DocumentItem | null>(null);
  // Menu entries a plugin adds for the history dialog it draws itself (none with the plugin off).
  const createActions = useSlotContributions("documents.create").flatMap((c) => c.meta?.actions ?? []);
  const historyActions = useSlotContributions("documents.history").flatMap((c) => (c.meta ? [c.meta.actionLabel] : []));

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const dragIdsRef = useRef<string[]>([]);

  const byId = useMemo(() => new Map((docs ?? []).map((d) => [d.id, d])), [docs]);

  // Leaving the active view / navigating resets transient selection.
  useEffect(() => {
    if (appliedView.current === view) return;
    appliedView.current = view;
    setCwd(null);
    setSelectedFileId(null);
    setChecked(new Set());
  }, [view]);

  const breadcrumbs = useMemo(() => {
    const chain: DocumentItem[] = [];
    let id = cwd;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const node = byId.get(id);
      if (!node) break;
      chain.unshift(node);
      id = node.parentId;
    }
    return chain;
  }, [cwd, byId]);

  // The rows to show: in the trash, only the *roots* of each trashed subtree
  // (restoring/purging a whole subtree, never a file from inside a trashed
  // folder — that keeps the server's `.trash/<id>` blob path unambiguous);
  // otherwise the current folder's children. Then name-search + type filter,
  // then sort (folders always lead).
  const rows = useMemo(() => {
    const all = docs ?? [];
    const base = trash
      ? all.filter((d) => d.deletedAt && (!d.parentId || !all.find((p) => p.id === d.parentId)?.deletedAt))
      : all.filter((d) => d.parentId === cwd);
    const q = debouncedQuery.trim().toLowerCase();
    const filtered = base.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (groupFilter && documentGroup(d) !== groupFilter) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (trash) return (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "");
      if (sort === "date") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "size") return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
      if (sort === "type") {
        const t = DOC_GROUP_LABEL[documentGroup(a)].localeCompare(DOC_GROUP_LABEL[documentGroup(b)], "ru");
        if (t !== 0) return t;
      }
      return a.name.localeCompare(b.name, "ru");
    });
  }, [docs, trash, cwd, debouncedQuery, groupFilter, sort]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!panelVisible || trash || newFolderOpen || renameTarget || moveTargets || pendingPurge || pendingBulkMove || historyTarget) {
        return;
      }
      if (isTypingTarget(event.target)) return;
      const ids = rows.map((row) => row.id);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = nextListId(ids, selectedFileIdRef.current, event.key === "ArrowDown" ? 1 : -1);
        if (next) {
          selectFile(next);
        }
        return;
      }
      if (event.key === "Enter" && selectedFileIdRef.current) {
        const doc = byId.get(selectedFileIdRef.current);
        if (!doc) return;
        event.preventDefault();
        if (doc.kind === "folder") openFolder(doc.id);
        return;
      }
      if ((event.key === "m" || event.key === "M") && !event.shiftKey) {
        const moving = checked.size > 0 ? [...checked] : selectedFileIdRef.current ? [selectedFileIdRef.current] : [];
        if (moving.length === 0) return;
        event.preventDefault();
        setMoveTargets(moving);
        return;
      }
      if (!event.shiftKey) return;
      const moving = checked.size > 0 ? [...checked] : selectedFileIdRef.current ? [selectedFileIdRef.current] : [];
      if (moving.length === 0) return;
      if (event.key === "ArrowLeft") {
        if (cwd === null) return;
        event.preventDefault();
        requestMove(moving, byId.get(cwd)?.parentId ?? null);
        return;
      }
      if (event.key === "ArrowRight") {
        const from = selectedFileIdRef.current ? rows.findIndex((row) => row.id === selectedFileIdRef.current) : -1;
        const nextFolder =
          rows.slice(from + 1).find((row) => row.kind === "folder" && !moving.includes(row.id)) ??
          rows.find((row) => row.kind === "folder" && !moving.includes(row.id));
        if (!nextFolder) return;
        event.preventDefault();
        requestMove(moving, nextFolder.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    panelVisible,
    trash,
    newFolderOpen,
    renameTarget,
    moveTargets,
    pendingPurge,
    pendingBulkMove,
    historyTarget,
    rows,
    selectedFileId,
    checked,
    cwd,
    byId,
    selectFile
  ]);

  const groupsPresent = useMemo(() => {
    const set = new Set<DocGroup>();
    for (const d of trash ? (docs ?? []) : (docs ?? []).filter((x) => x.parentId === cwd)) set.add(documentGroup(d));
    return [...set];
  }, [docs, trash, cwd]);

  const selectedFile = selectedFileId ? byId.get(selectedFileId) ?? null : null;
  const editorFocus = twoPane && listCollapsed && selectedFile !== null && !trash && layout === "list";

  // --- actions ----------------------------------------------------------

  function toggleChecked(id: string): void {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openFolder(id: string | null): void {
    guardNavigation(() => {
      setCwd(id);
      selectedFileIdRef.current = null;
      setSelectedFileId(null);
      setEditorDirty(false);
      setChecked(new Set());
    });
  }

  function runUpload(chipId: string, files: File[], parentId: string | null): void {
    uploadDocs.mutate(
      { parentId, files },
      {
        onSuccess: (created) => {
          setUploadChips((cur) => cur.map((c) => (c.id === chipId ? { ...c, status: "done" } : c)));
          setTimeout(() => setUploadChips((cur) => cur.filter((c) => c.id !== chipId)), 2200);
          toast({ title: `Загружено: ${created.length}`, tone: "success" });
        },
        onError: (e) => {
          setUploadChips((cur) => cur.map((c) => (c.id === chipId ? { ...c, status: "error" } : c)));
          toast({ title: "Не удалось загрузить", description: (e as Error).message, tone: "danger" });
        }
      }
    );
  }

  function handleUploadFiles(files: File[], parentId: string | null): void {
    if (files.length === 0) return;
    const chipId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const label = files.length === 1 ? files[0].name : `Загрузка: ${files.length} файлов`;
    const sublabel = files.length === 1 ? formatBytes(files[0].size) : undefined;
    setUploadChips((cur) => [...cur, { id: chipId, label, sublabel, status: "running", files, parentId }]);
    runUpload(chipId, files, parentId);
  }

  /**
   * O04 — "Создать документ"/"Создать таблицу": generate a valid empty
   * DOCX/XLSX with the O01/O02 codecs and send it through the same
   * `uploadDocuments` path as a drag-and-dropped file — no new endpoint,
   * per 12-PROGRESS.md "O02" §4.
   *
   * `plugins/documents-office/codecs/office-files` (reached via the
   * `documents.create` slot, together with the DOCX/XLSX codecs it wraps —
   * Tiptap/docx, exceljs/HyperFormula/modern-xlsx) is imported dynamically
   * here rather than at module scope: DocumentsPanel itself is already
   * lazy-loaded per-panel (`lib/panel-registry.ts`'s `next/dynamic`), but a
   * static top-level import still pulled the whole office codec into that
   * one panel chunk unconditionally, and webpack's automatic chunk-splitting
   * then listed it as a preloadable asset for every `/panel/[panelId]`
   * route, not only when Документы/office actions are actually used.
   * Deferring the import to the click handler keeps it a true on-demand
   * chunk — checked via `pnpm --filter @orion/web build` build output.
   */
  async function createOfficeDocument(action: DocumentCreateAction): Promise<void> {
    try {
      const file = await action.createFile();
      const created = await uploadDocs.mutateAsync({ parentId: cwd, files: [file] });
      toast({ title: action.successTitle, tone: "success" });
      if (created[0]) selectFile(created[0].id);
    } catch (e) {
      toast({ title: "Не удалось создать файл", description: (e as Error).message, tone: "danger" });
    }
  }

  function submitNewFolder(): void {
    const name = newFolderName.trim();
    if (!name) return;
    createFolder.mutate(
      { parentId: cwd, name },
      {
        onSuccess: () => {
          toast({ title: "Папка создана", tone: "success" });
          setNewFolderOpen(false);
          setNewFolderName("");
        },
        onError: (e) => toast({ title: "Не удалось создать папку", description: (e as Error).message, tone: "danger" })
      }
    );
  }

  function submitRename(): void {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    renameOrMove.mutate(
      { id: renameTarget.id, input: { name } },
      {
        onSuccess: () => {
          toast({ title: "Переименовано", tone: "success" });
          setRenameTarget(null);
        },
        onError: (e) => toast({ title: "Не удалось переименовать", description: (e as Error).message, tone: "danger" })
      }
    );
  }

  function moveMany(ids: string[], parentId: string | null): void {
    const real = ids.filter((id) => id !== parentId);
    if (real.length === 0) return;
    const done = () => {
      toast({ title: real.length === 1 ? "Перемещено" : `Перемещено: ${real.length}`, tone: "success" });
      setChecked(new Set());
      setMoveTargets(null);
    };
    const fail = (e: unknown) => toast({ title: "Не удалось переместить", description: (e as Error).message, tone: "danger" });
    if (real.length === 1) {
      renameOrMove.mutate({ id: real[0], input: { parentId } }, { onSuccess: done, onError: fail });
    } else {
      bulk.mutate({ op: "move", ids: real, parentId }, { onSuccess: done, onError: fail });
    }
  }

  function requestMove(ids: string[], parentId: string | null): void {
    if (ids.length > 1) {
      setPendingBulkMove({ ids, parentId });
      setMoveTargets(null);
      return;
    }
    moveMany(ids, parentId);
  }

  function trashMany(ids: string[]): void {
    const done = () => {
      toast({ title: "Перемещено в корзину", tone: "default" });
      setChecked(new Set());
      setSelectedFileId((cur) => (cur && ids.includes(cur) ? null : cur));
    };
    if (ids.length === 1) deleteDoc.mutate(ids[0], { onSuccess: done });
    else bulk.mutate({ op: "trash", ids }, { onSuccess: done });
  }

  function restoreMany(ids: string[]): void {
    const done = () => {
      toast({ title: "Восстановлено", tone: "success" });
      setChecked(new Set());
    };
    if (ids.length === 1) restoreDoc.mutate(ids[0], { onSuccess: done });
    else bulk.mutate({ op: "restore", ids }, { onSuccess: done });
  }

  function confirmPurge(): void {
    if (!pendingPurge) return;
    const { ids } = pendingPurge;
    setPendingPurge(null);
    const done = () => {
      toast({ title: "Удалено навсегда", tone: "default" });
      setChecked(new Set());
    };
    if (ids.length === 1) purgeDoc.mutate(ids[0], { onSuccess: done });
    else bulk.mutate({ op: "purge", ids }, { onSuccess: done });
  }

  async function download(doc: DocumentItem): Promise<void> {
    if (!workspaceId) return;
    try {
      const blob = await api.getDocumentBlob(workspaceId, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Не удалось скачать", description: (e as Error).message, tone: "danger" });
    }
  }

  function triggerReplace(doc: DocumentItem): void {
    replaceTargetRef.current = doc.id;
    replaceInputRef.current?.click();
  }

  function handleReplaceFile(file: File | undefined): void {
    const id = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (!id || !file) return;
    replaceContent.mutate(
      { id, file },
      {
        onSuccess: () => toast({ title: "Содержимое заменено", tone: "success" }),
        onError: (e) => toast({ title: "Не удалось заменить", description: (e as Error).message, tone: "danger" })
      }
    );
  }

  // --- drag & drop ----------------------------------------------------------

  function rowDragStart(id: string): void {
    dragIdsRef.current = checked.has(id) ? [...checked] : [id];
  }

  function dropOnto(e: React.DragEvent, parentId: string | null): void {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (trash) return;
    if (e.dataTransfer.types.includes("Files") && e.dataTransfer.files.length > 0) {
      handleUploadFiles(Array.from(e.dataTransfer.files), parentId);
      return;
    }
    const ids = dragIdsRef.current;
    dragIdsRef.current = [];
    if (ids.length > 0) requestMove(ids, parentId);
  }

  // --- render ----------------------------------------------------------

  /** Shared row/card action menu — trash items get restore/purge, active items the usual file ops. */
  function docMenuItems(doc: DocumentItem, isFolder: boolean): (MenuItem | "separator")[] {
    return trash
      ? [
          { label: "Восстановить", icon: RotateCcw, onSelect: () => restoreMany([doc.id]) },
          "separator",
          {
            label: "Удалить навсегда",
            icon: Trash2,
            tone: "danger",
            onSelect: () => setPendingPurge({ ids: [doc.id], label: doc.name })
          }
        ]
      : [
          ...(isFolder
            ? []
            : [
                { label: "Скачать", icon: Download, onSelect: () => void download(doc) },
                { label: "Заменить содержимое…", icon: Upload, onSelect: () => triggerReplace(doc) },
                ...historyActions.map((label) => ({ label, icon: History, onSelect: () => setHistoryTarget(doc) }))
              ]),
          {
            label: "Переименовать",
            icon: Pencil,
            onSelect: () => {
              setRenameTarget(doc);
              setRenameValue(doc.name);
            }
          },
          { label: "Переместить…", icon: FolderOpen, onSelect: () => setMoveTargets([doc.id]) },
          "separator",
          { label: "Удалить", icon: Trash2, tone: "danger", onSelect: () => trashMany([doc.id]) }
        ];
  }

  /** One open action for the row, its name button and the grid card. A folder in the trash does not open. */
  function openRow(doc: DocumentItem): void {
    if (doc.kind === "folder") {
      if (!trash) openFolder(doc.id);
    } else selectFile(doc.id);
  }

  const checkedList = [...checked];

  const list = (
    <div
      className="orion-scroll relative flex-1 overflow-y-auto p-3"
      onDragOver={(e) => {
        if (trash) return;
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => dropOnto(e, cwd)}
      onContextMenu={(e) =>
        showContextMenu(
          e,
          trash
            ? null
            : [
                { label: "Новая папка", icon: FolderPlus, onSelect: () => setNewFolderOpen(true) },
                { label: "Загрузить файлы", icon: Upload, onSelect: () => fileInputRef.current?.click() }
              ]
        )
      }
    >
      <AnimatePresence>
        {dragOver && !trash ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.15 }}
            className="pointer-events-none absolute -inset-3 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent/50 bg-card px-10 py-8 text-center">
              <motion.span
                animate={reducedMotion ? undefined : { y: [0, -6, 0] }}
                transition={reducedMotion ? undefined : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent-text"
              >
                <Upload className="h-6 w-6" />
              </motion.span>
              <p className="text-sm font-medium text-foreground">Отпустите, чтобы загрузить</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!trash ? (
        <nav className="mb-2 flex flex-wrap items-center gap-0.5 px-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => openFolder(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnto(e, null)}
            className={cx("rounded px-1.5 py-0.5 hover:text-foreground", cwd === null && "text-foreground")}
          >
            Все файлы
          </button>
          {breadcrumbs.map((node) => (
            <span key={node.id} className="flex items-center gap-0.5">
              <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              <button
                type="button"
                onClick={() => openFolder(node.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => dropOnto(e, node.id)}
                className={cx("max-w-[12rem] truncate rounded px-1.5 py-0.5 hover:text-foreground", node.id === cwd && "text-foreground")}
              >
                {node.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {groupsPresent.length > 1 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
          <FilterChip active={groupFilter === null} onClick={() => setGroupFilter(null)}>
            Все
          </FilterChip>
          {groupsPresent.map((g) => (
            <FilterChip key={g} active={groupFilter === g} onClick={() => setGroupFilter(g)}>
              {DOC_GROUP_LABEL[g]}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={trash ? Trash2 : FolderOpen}
            title={trash ? "Корзина пуста" : query || groupFilter ? "Ничего не найдено" : "Здесь пока пусто"}
            description={
              trash
                ? "Удалённые файлы хранятся здесь 30 дней, потом стираются насовсем."
                : query || groupFilter
                  ? "Сбросьте поиск или фильтр по типу — в этой папке файлы есть."
                  : "Загрузите файлы кнопкой сверху или перетащите их сюда."
            }
            action={
              query || groupFilter ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setGroupFilter(null);
                  }}
                >
                  Сбросить фильтры
                </Button>
              ) : !trash ? (
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Выбрать файлы
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {rows.map((doc) => {
            const isFolder = doc.kind === "folder";
            const active = doc.id === selectedFileId;
            const menuItems = docMenuItems(doc, isFolder);
            return (
              <div
                key={doc.id}
                draggable={!trash}
                onDragStart={() => rowDragStart(doc.id)}
                onDragOver={isFolder && !trash ? (e) => e.preventDefault() : undefined}
                onDrop={isFolder && !trash ? (e) => dropOnto(e, doc.id) : undefined}
                onClick={() => openRow(doc)}
                onContextMenu={(e) => showContextMenu(e, menuItems)}
                className={cx(
                  "group relative flex flex-col gap-1.5 rounded-xl border p-2",
                  trash ? "border-transparent" : "cursor-pointer",
                  active ? "border-accent/40 bg-accent/[0.07]" : "border-transparent hover:border-border hover:bg-card-hover"
                )}
              >
                {!trash ? (
                  <input
                    type="checkbox"
                    checked={checked.has(doc.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleChecked(doc.id)}
                    className="absolute left-3 top-3 z-10 h-3.5 w-3.5 accent-accent"
                    aria-label={`Выбрать ${doc.name}`}
                  />
                ) : null}
                <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
                  <DropdownMenu
                    align="end"
                    trigger={({ toggle }) => (
                      <IconButton
                        label="Действия"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </IconButton>
                    )}
                    items={menuItems}
                  />
                </div>
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-white/[0.03]">
                  <DocThumbnail doc={doc} isImage={!isFolder && documentGroup(doc) === "image"} />
                </div>
                <OpenControl doc={doc} trash={trash} onOpen={() => openRow(doc)} className="block min-w-0 rounded text-left">
                  <DocName name={doc.name} className="text-xs font-medium text-foreground" />
                </OpenControl>
                <p className="truncate text-2xs text-subtle-foreground">
                  {isFolder ? "" : formatBytes(doc.sizeBytes)}
                  {!isFolder && doc.sizeBytes != null ? " · " : ""}
                  {trash && doc.deletedAt ? `удалено ${relativeTime(doc.deletedAt)}` : relativeTime(doc.updatedAt)}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-border">
          <div
            className={cx(
              "grid items-center gap-2 border-b border-border px-2.5 py-1.5 text-2xs uppercase tracking-wide text-subtle-foreground",
              compactList
                ? "grid-cols-[1.75rem_minmax(0,1fr)_2rem]"
                : "grid-cols-[1.75rem_minmax(0,1fr)_5rem_7rem_2rem]"
            )}
          >
            <span />
            <span>Имя</span>
            {!compactList ? (
              <>
                <span className="text-right">Размер</span>
                <span className="text-right">Изменён</span>
              </>
            ) : null}
            <span />
          </div>
          <ul className="divide-y divide-border">
            {rows.map((doc) => {
              const Icon = documentIcon(doc);
              const isFolder = doc.kind === "folder";
              const active = doc.id === selectedFileId;
              return (
                <li key={doc.id}>
                  <div
                    draggable={!trash}
                    onDragStart={() => rowDragStart(doc.id)}
                    onDragOver={isFolder && !trash ? (e) => e.preventDefault() : undefined}
                    onDrop={isFolder && !trash ? (e) => dropOnto(e, doc.id) : undefined}
                    onClick={() => openRow(doc)}
                    onContextMenu={(e) => showContextMenu(e, docMenuItems(doc, isFolder))}
                    className={cx(
                      "group grid items-center gap-2 px-2.5 py-2 transition-colors",
                      compactList
                        ? "grid-cols-[1.75rem_minmax(0,1fr)_2rem]"
                        : "grid-cols-[1.75rem_minmax(0,1fr)_5rem_7rem_2rem]",
                      trash ? "" : "cursor-pointer",
                      active ? "bg-accent/[0.07]" : checked.has(doc.id) ? "bg-accent/[0.04]" : "hover:bg-card-hover"
                    )}
                  >
                    {!trash ? (
                      <input
                        type="checkbox"
                        checked={checked.has(doc.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleChecked(doc.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-accent"
                        aria-label={`Выбрать ${doc.name}`}
                      />
                    ) : (
                      <span />
                    )}
                    {/* The name is the row's real control: Tab reaches it and Enter opens the folder or file,
                        which the clickable row alone never allowed. */}
                    <OpenControl doc={doc} trash={trash} onOpen={() => openRow(doc)} className="flex min-w-0 items-start gap-2 rounded text-left">
                      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", isFolder ? "text-accent-text" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1">
                        <DocName name={doc.name} className="text-sm text-foreground" />
                        {compactList ? (
                          <span className="block truncate text-2xs text-subtle-foreground">
                            {!isFolder && doc.sizeBytes != null ? `${formatBytes(doc.sizeBytes)} · ` : ""}
                            {trash && doc.deletedAt ? `удалено ${relativeTime(doc.deletedAt)}` : relativeTime(doc.updatedAt)}
                          </span>
                        ) : null}
                      </span>
                    </OpenControl>
                    {!compactList ? (
                      <>
                        <span className="shrink-0 text-right text-2xs tabular-nums text-subtle-foreground">
                          {isFolder ? "" : formatBytes(doc.sizeBytes)}
                        </span>
                        <span className="shrink-0 text-right text-2xs tabular-nums text-subtle-foreground">
                          {trash && doc.deletedAt ? `удалено ${relativeTime(doc.deletedAt)}` : relativeTime(doc.updatedAt)}
                        </span>
                      </>
                    ) : null}
                    <div className={cx("flex justify-end transition-opacity", compactList ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
                      <DropdownMenu
                        align="end"
                        trigger={({ toggle }) => (
                          <IconButton
                            label="Действия"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle();
                            }}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </IconButton>
                        )}
                        items={docMenuItems(doc, isFolder)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AnimatePresence>
        {checkedList.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            role="toolbar"
            aria-label="Выбранные документы"
            className="sticky bottom-0 mt-2 flex items-center gap-0.5 rounded-xl border border-border bg-panel/95 p-1.5 text-xs backdrop-blur"
          >
            <IconButton label="Снять выбор" size="sm" className="shrink-0" onClick={() => setChecked(new Set())}>
              <X className="h-4 w-4" />
            </IconButton>
            <span className="mr-auto min-w-0 truncate pr-1 text-muted-foreground">Выбрано: {checkedList.length}</span>
            {/* The buttons keep their one-line labels; the count gives way first on a narrow list. */}
            <Button size="sm" variant="subtle" className="shrink-0 whitespace-nowrap" onClick={() => setMoveTargets(checkedList)}>
              Переместить…
            </Button>
            <Button size="sm" variant="subtle" className="shrink-0 whitespace-nowrap" onClick={() => trashMany(checkedList)}>
              В корзину
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {uploadChips.length > 0 ? (
        <div className="sticky bottom-0 mt-2 space-y-1.5">
          <AnimatePresence initial={false}>
            {uploadChips.map((chip) => (
              <CallChip
                key={chip.id}
                label={chip.label}
                sublabel={chip.sublabel}
                status={chip.status}
                onRetry={
                  chip.status === "error"
                    ? () => {
                        setUploadChips((cur) => cur.map((c) => (c.id === chip.id ? { ...c, status: "running" } : c)));
                        runUpload(chip.id, chip.files, chip.parentId);
                      }
                    : undefined
                }
              />
            ))}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );

  const preview =
    selectedFile && selectedFile.kind === "file" ? (
      <PreviewPane
        key={selectedFile.id}
        doc={selectedFile}
        onDownload={() => void download(selectedFile)}
        onRename={(name) => renameOrMove.mutate({ id: selectedFile.id, input: { name } })}
        renameBusy={renameOrMove.isPending}
        onEditorDirtyChange={setEditorDirty}
        onToggleList={twoPane ? () => setListCollapsed((collapsed) => !collapsed) : undefined}
        listCollapsed={twoPane && listCollapsed}
      />
    ) : (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={FolderOpen} title="Выберите файл" description="Его содержимое откроется здесь." />
      </div>
    );

  return (
    <PanelShell>
      <PanelHeader
        icon={FolderOpen}
        title="Документы"
        subtitle={docs ? `${docs.filter((d) => d.kind === "file").length} файлов` : undefined}
        actions={
          trash ? undefined : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleUploadFiles(Array.from(e.target.files ?? []), cwd);
                  e.target.value = "";
                }}
              />
              <input
                ref={replaceInputRef}
                type="file"
                hidden
                onChange={(e) => {
                  handleReplaceFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {compactActions ? (
                <DropdownMenu
                  align="end"
                  trigger={({ toggle }) => (
                    <Button size="sm" onClick={toggle} aria-label="Действия с документами">
                      <FolderPlus className="h-4 w-4" /> Добавить
                    </Button>
                  )}
                  items={[
                    { label: "Новая папка", icon: FolderPlus, onSelect: () => setNewFolderOpen(true) },
                    ...createActions.map((action) => ({ label: action.menuLabel, icon: action.icon, onSelect: () => void createOfficeDocument(action) })),
                    { label: "Загрузить файлы", icon: Upload, onSelect: () => fileInputRef.current?.click() }
                  ]}
                />
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
                    <FolderPlus className="h-4 w-4" /> Папка
                  </Button>
                  {createActions.map((action) => (
                    <Button key={action.id} size="sm" variant="outline" onClick={() => void createOfficeDocument(action)}>
                      <action.icon className="h-4 w-4" /> {action.buttonLabel}
                    </Button>
                  ))}
                  <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Загрузить
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {!editorFocus ? (
          <>
            <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по имени" aria-label="Поиск по имени" className="pl-8" />
            </div>
            {!trash ? (
              <SegmentedControl<SortKey>
                aria-label="Сортировка"
                value={sort}
                onChange={setSort}
                size="sm"
                options={[
                  { value: "name", label: "Имя" },
                  { value: "date", label: "Дата" },
                  { value: "size", label: "Размер" },
                  { value: "type", label: "Тип" }
                ]}
              />
            ) : null}
            <SegmentedControl<Layout>
              aria-label="Вид файлов"
              value={layout}
              onChange={setLayout}
              size="sm"
              options={[
                { value: "list", label: <List className="h-3.5 w-3.5" />, ariaLabel: "Списком" },
                { value: "grid", label: <LayoutGrid className="h-3.5 w-3.5" />, ariaLabel: "Плиткой" }
              ]}
            />
            <SegmentedControl<DocumentView>
              value={view}
              onChange={(next) => guardNavigation(() => { setEditorDirty(false); setView(next); })}
              size="sm"
              options={[
                { value: "active", label: "Активные" },
                { value: "trash", label: "Корзина" }
              ]}
            />
          </>
        ) : null}
      </PanelHeader>

      <div ref={wrapRef} className="flex min-h-0 flex-1">
        {trash || layout === "grid" ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col">{list}</div>
            {!trash ? (
              <Sheet open={Boolean(selectedFile)} onClose={() => selectFile(null)} title={selectedFile?.name ?? "Файл"} bare>
                {preview}
              </Sheet>
            ) : null}
          </>
        ) : twoPane ? (
          <>
            <div className={cx("w-[22rem] shrink-0 flex-col border-r border-border", listCollapsed && selectedFile ? "hidden" : "flex")}>{list}</div>
            <div className="min-w-0 flex-1">{preview}</div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col">{list}</div>
            <Sheet open={Boolean(selectedFile)} onClose={() => selectFile(null)} title={selectedFile?.name ?? "Файл"} bare>
              {preview}
            </Sheet>
          </>
        )}
      </div>

      <Modal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title="Новая папка"
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setNewFolderOpen(false)}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={submitNewFolder}
              disabled={!newFolderName.trim()}
              status={createFolder.isPending ? "pending" : createFolder.isSuccess ? "success" : createFolder.isError ? "error" : "idle"}
            >
              Создать
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitNewFolder()}
          placeholder="Название папки"
        />
      </Modal>

      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Переименовать"
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setRenameTarget(null)}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={submitRename}
              disabled={!renameValue.trim()}
              status={renameOrMove.isPending ? "pending" : renameOrMove.isSuccess ? "success" : renameOrMove.isError ? "error" : "idle"}
            >
              Сохранить
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitRename()}
        />
      </Modal>

      <MoveDialog
        open={moveTargets !== null}
        docs={docs ?? []}
        movingIds={moveTargets ?? []}
        onClose={() => setMoveTargets(null)}
        onPick={(parentId) => requestMove(moveTargets ?? [], parentId)}
      />

      <TypeToConfirmDialog
        open={pendingPurge !== null}
        title="Удалить навсегда?"
        phrase={pendingPurge && pendingPurge.ids.length === 1 ? pendingPurge.label : "УДАЛИТЬ"}
        description={
          pendingPurge
            ? pendingPurge.ids.length === 1
              ? `«${pendingPurge.label}» и его содержимое будут стёрты без корзины.`
              : `Будут безвозвратно стёрты ${pendingPurge.ids.length} файлов.`
            : ""
        }
        onConfirm={confirmPurge}
        onCancel={() => setPendingPurge(null)}
      />

      <TypeToConfirmDialog
        open={pendingBulkMove !== null}
        title="Переместить файлы?"
        phrase="ПЕРЕМЕСТИТЬ"
        confirmLabel="Переместить"
        description={
          pendingBulkMove
            ? `Сейчас сдвинутся ${pendingBulkMove.ids.length} файлов. Отменить пачкой потом нельзя — только по одному.`
            : ""
        }
        onConfirm={() => {
          if (!pendingBulkMove) return;
          const { ids, parentId } = pendingBulkMove;
          setPendingBulkMove(null);
          moveMany(ids, parentId);
        }}
        onCancel={() => setPendingBulkMove(null)}
      />

      <ConfirmDialog
        open={pendingNavigation !== null}
        title="Закрыть без сохранения?"
        description="В документе есть несохранённые изменения. Сохраните их в редакторе или подтвердите переход без сохранения."
        confirmLabel="Не сохранять"
        danger
        onConfirm={() => {
          const next = pendingNavigation;
          setPendingNavigation(null);
          setEditorDirty(false);
          editorDirtyRef.current = false;
          next?.();
        }}
        onCancel={() => setPendingNavigation(null)}
      />

      <ExtensionSlot name="documents.history" props={{ workspaceId, doc: historyTarget, onClose: () => setHistoryTarget(null) }} />
    </PanelShell>
  );
}

/** Folder picker for "Переместить…". Lists every live folder as an indented tree; a moving folder and its descendants are disabled. */
function MoveDialog({
  open,
  docs,
  movingIds,
  onClose,
  onPick
}: {
  open: boolean;
  docs: DocumentItem[];
  movingIds: string[];
  onClose: () => void;
  onPick: (parentId: string | null) => void;
}): React.ReactElement {
  const folders = useMemo(() => docs.filter((d) => d.kind === "folder" && !d.deletedAt), [docs]);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, DocumentItem[]>();
    for (const f of folders) {
      const list = map.get(f.parentId) ?? [];
      list.push(f);
      map.set(f.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return map;
  }, [folders]);

  const blocked = useMemo(() => {
    const set = new Set(movingIds);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && set.has(f.parentId) && !set.has(f.id)) {
          set.add(f.id);
          grew = true;
        }
      }
    }
    return set;
  }, [folders, movingIds]);

  function renderLevel(parentId: string | null, depth: number): React.ReactNode {
    const list = childrenOf.get(parentId) ?? [];
    return list.map((folder) => (
      <div key={folder.id}>
        <button
          type="button"
          disabled={blocked.has(folder.id)}
          onClick={() => onPick(folder.id)}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm text-foreground hover:bg-card-hover disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-accent-text" />
          <span className="truncate">{folder.name}</span>
        </button>
        {renderLevel(folder.id, depth + 1)}
      </div>
    ));
  }

  return (
    <Modal open={open} onClose={onClose} title="Переместить в…">
      <div className="orion-scroll max-h-80 overflow-y-auto">
        <button
          type="button"
          onClick={() => onPick(null)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-foreground hover:bg-card-hover"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-accent-text" /> Все файлы (корень)
        </button>
        {renderLevel(null, 1)}
      </div>
    </Modal>
  );
}

/**
 * The keyboard and screen-reader way into a row: a button around the name. Its click does not bubble to the
 * row, which opens the same thing for a mouse click anywhere else on it.
 */
function OpenControl({
  doc,
  trash,
  onOpen,
  className,
  children
}: {
  doc: DocumentItem;
  trash: boolean;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (trash && doc.kind === "folder") return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      aria-label={doc.kind === "folder" ? `Открыть папку ${doc.name}` : `Открыть ${doc.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cx(className, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}
    >
      {children}
    </button>
  );
}

/**
 * One line with the extension kept: «Чек 01 — строительный ма….txt» still says what kind of file it is, and
 * names that differ only by type stay apart. The full name is in the tooltip and the preview.
 */
function DocName({ name, className }: { name: string; className?: string }): React.ReactElement {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  return (
    <span className={cx("flex min-w-0", className)} title={name}>
      <span className="truncate">{ext ? name.slice(0, dot) : name}</span>
      {ext ? <span className="shrink-0">{ext}</span> : null}
    </span>
  );
}
