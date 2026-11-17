"use client";

import {
  KNOWLEDGE_KINDS,
  isKnowledgeInbox,
  type KnowledgeCategory,
  type KnowledgeItem,
  type KnowledgeKind,
  type KnowledgeStatus
} from "@orion/shared-types";
import {
  useAddKnowledgeSource,
  useCreateFolder,
  useCreateKnowledgeCategory,
  useCreateKnowledgeItem,
  useDeleteKnowledgeCategory,
  useKnowledgeCategories,
  useKnowledgeItem,
  useKnowledgeItems,
  useUpdateKnowledgeItem,
  useUploadDocuments
} from "@orion/core-react";
import {
  Button,
  EmptyState,
  Input,
  PanelBody,
  PanelShell,
  SegmentedControl,
  cx,
  useContextMenuApi,
  useDebouncedValue,
  useToast
} from "@orion/ui";
import { ArrowUpDown, BookOpen, FolderPlus, LayoutGrid, Library, List, Plus, Search } from "lucide-react";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useKnowledgeFocusRequest } from "../lib/panel-bus";
import { relativeTime } from "../lib/format";
import { KnowledgeItemEditor } from "./knowledge/item-editor";
import { CollectionSidebar, type CollectionSelection } from "./knowledge/collection-sidebar";
import { DropZone } from "./knowledge/drop-zone";
import { InboxRow } from "./knowledge/inbox-row";
import { KbdBar } from "./knowledge/kbd-bar";
import { MaterialCard } from "./knowledge/material-card";
import { KnowledgeReadingView } from "./knowledge/reading-view";
import { StatusRibbon } from "./knowledge/status-ribbon";
import { KIND_LABEL } from "./knowledge/knowledge-labels";

type View = "library" | "inbox" | "reading" | "editing";
type Sort = "updated" | "title" | "created";
type ImportFile = { file: File; path: string };

async function expandArchives(files: File[]): Promise<ImportFile[]> {
  const expanded: ImportFile[] = [];
  for (const file of files) {
    const inputPath = file.webkitRelativePath || file.name;
    if (!/\.zip$/i.test(file.name)) {
      expanded.push({ file, path: inputPath });
      continue;
    }
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > 5_000) throw new Error(`В архиве «${file.name}» больше 5 000 файлов`);
    const prefix = inputPath.includes("/") ? inputPath.slice(0, inputPath.lastIndexOf("/") + 1) : "";
    for (const entry of entries) {
      const segments = entry.name.split("/").filter(Boolean);
      if (segments.length === 0 || segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) {
        throw new Error(`Архив «${file.name}» содержит небезопасный путь`);
      }
      const blob = await entry.async("blob");
      expanded.push({ file: new File([blob], segments.at(-1)!, { type: blob.type }), path: prefix + segments.join("/") });
    }
  }
  return expanded;
}

/**
 * База знаний — редизайн «полки» (экраны 01–03 спецификации):
 *  01 Библиотека: лента созревания, сайдбар коллекций, сетка карточек;
 *  02 Входящие: DropZone, строки сырья с клавиатурным разбором (J/K/E/X);
 *  03 Чтение: колонка материала + правая колонка (источник, связи, теги).
 * Экраны 04/05 (читалка книг, просмотр документов) — этап 2, здесь не делаются.
 */
export function KnowledgePanel() {
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();
  const focusRequest = useKnowledgeFocusRequest();
  const reportError = (error: unknown) => toast({ title: "Не удалось выполнить действие", description: error instanceof Error ? error.message : "Попробуйте ещё раз.", tone: "danger" });
  const workspaceId = workspace?.id;
  const [view, setView] = useState<View>("library");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [editorDirty, setEditorDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<CollectionSelection>("all");
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatus | null>(null);
  const [title, setTitle] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [kindFilter, setKindFilter] = useState<KnowledgeKind | "all">("all");
  const [addMenu, setAddMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [inboxIndex, setInboxIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const debounced = useDebouncedValue(query, 300);
  const categories = useKnowledgeCategories(workspaceId);
  const allItems = useKnowledgeItems(workspaceId, true, "");
  const items = useKnowledgeItems(workspaceId, categoryId === "archive", debounced);
  const detail = useKnowledgeItem(workspaceId, view === "reading" || view === "editing" ? (selectedId ?? undefined) : undefined);
  const createCategory = useCreateKnowledgeCategory(workspaceId ?? "");
  const deleteCategory = useDeleteKnowledgeCategory(workspaceId ?? "");
  const createItem = useCreateKnowledgeItem(workspaceId ?? "");
  const updateItem = useUpdateKnowledgeItem(workspaceId ?? "");
  const addSource = useAddKnowledgeSource(workspaceId ?? "");
  const uploadDocuments = useUploadDocuments(isEnabled("documents") ? workspaceId : undefined);
  const createFolder = useCreateFolder(isEnabled("documents") ? workspaceId : undefined);
  const showContextMenu = useContextMenuApi();

  useEffect(() => {
    if (!focusRequest) return;
    if (editorDirty) {
      toast({ title: "Сначала сохраните материал", description: "В открытом материале есть несохранённые изменения.", tone: "default" });
      return;
    }
    setView("reading");
    setCategoryId("all");
    setStatusFilter(null);
    setKindFilter("all");
    setQuery("");
    setSelectedId(focusRequest.id);
  }, [focusRequest, editorDirty, toast]);

  /* Счётчики ленты и сайдбара — из полного списка, без учёта поиска. */
  const ribbonCounts = useMemo(() => {
    const counts: Record<KnowledgeStatus, number> = { captured: 0, draft: 0, review: 0, approved: 0, published: 0, archived: 0 };
    for (const item of allItems.data ?? []) counts[item.status] += 1;
    return counts;
  }, [allItems.data]);
  const sidebarCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, archive: 0 };
    for (const item of allItems.data ?? []) {
      if (item.status === "archived") counts.archive += 1;
      else {
        counts.all += 1;
        if (item.categoryId) counts[item.categoryId] = (counts[item.categoryId] ?? 0) + 1;
      }
    }
    return counts;
  }, [allItems.data]);

  const visible = useMemo(() => {
    const ids = categoryScope(categoryId, categories.data ?? []);
    const filtered = (items.data ?? []).filter((item) => {
      if (categoryId === "archive") return item.status === "archived";
      if (item.status === "archived") return false;
      if (ids && !ids.has(item.categoryId ?? "")) return false;
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (view === "inbox") return isKnowledgeInbox(item.status);
      return !isKnowledgeInbox(item.status);
    });
    return filtered.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ru") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [items.data, categories.data, categoryId, view, statusFilter, sort, kindFilter]);

  const inboxVisible = view === "inbox" ? visible.filter((item) => isKnowledgeInbox(item.status)) : [];

  /* Клавиатура входящих: J/K — навигация, E — принять, X — архив. */
  useEffect(() => {
    if (view !== "inbox") return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const rows = inboxVisible;
      if (rows.length === 0) return;
      const key = event.key.toLowerCase();
      if (key === "j" || event.key === "ArrowDown") { event.preventDefault(); setInboxIndex((i) => Math.min(i + 1, rows.length - 1)); }
      else if (key === "k" || event.key === "ArrowUp") { event.preventDefault(); setInboxIndex((i) => Math.max(i - 1, 0)); }
      else if (key === "e") { event.preventDefault(); const item = rows[Math.min(inboxIndex, rows.length - 1)]; if (item) accept(item); }
      else if (key === "x") { event.preventDefault(); const item = rows[Math.min(inboxIndex, rows.length - 1)]; if (item) archive(item); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, inboxVisible, inboxIndex]);

  if (!workspaceId) {
    return (
      <PanelShell>
        <PanelBody className="[container-type:inline-size]">
          <EmptyState icon={Library} title="Нет пространства" description="Выберите пространство, чтобы открыть базу знаний." />
        </PanelBody>
      </PanelShell>
    );
  }

  function selectItem(id: string | null) {
    if (editorDirty) {
      toast({ title: "Сначала сохраните материал", description: "В открытом материале есть несохранённые изменения.", tone: "default" });
      return;
    }
    setSelectedId(id);
    setView(id ? "reading" : "library");
  }

  function accept(item: KnowledgeItem) {
    updateItem.mutate({ itemId: item.id, input: { status: "draft", expectedRevision: item.revision } });
  }
  function archive(item: KnowledgeItem) {
    updateItem.mutate({ itemId: item.id, input: { status: "archived", expectedRevision: item.revision } });
  }

  function create(name: string) {
    if (editorDirty) { selectItem(null); return; }
    const next = name.trim() || "Новый материал";
    void createItem
      .mutateAsync({ title: next, categoryId: categoryId !== "all" && categoryId !== "archive" ? categoryId : null, status: "captured" })
      .then((item) => {
        setTitle("");
        setSelectedId(item.id);
        setView("editing");
      }).catch(reportError);
  }

  async function importLink(url: string, description = "") {
    const link = url.trim();
    if (!link) return;
    try {
      const item = await createItem.mutateAsync({
        title: link.replace(/^https?:\/\//, "").split(/[/?#]/)[0] || "Новая ссылка",
        summary: description.trim(),
        categoryId: categoryId !== "all" && categoryId !== "archive" ? categoryId : null,
        kind: "link",
        status: "captured"
      });
      await addSource.mutateAsync({ itemId: item.id, input: { type: "url", sourceUrl: link, sourceTitle: link } });
      setSourceUrl("");
      setSourceDescription("");
      setView("inbox");
      toast({ title: "Ссылка во входящих", description: "Примите её, когда будете готовы.", tone: "success" });
      void item;
    } catch (error) { reportError(error); }
  }

  async function importFiles(files: FileList | File[] | null, folder = false) {
    if (!files?.length || !workspaceId) return;
    const list = files instanceof FileList ? [...files] : files;
    try {
      const expanded = await expandArchives(list);
      const uploaded: Awaited<ReturnType<typeof uploadDocuments.mutateAsync>> = [];
      if (folder || expanded.some((entry) => entry.path.includes("/"))) {
        const folders = new Map<string, string | null>([["", null]]);
        const groups = new Map<string, File[]>();
        for (const entry of expanded) {
          const parts = entry.path.split("/").filter(Boolean);
          parts.pop();
          let path = "";
          let parentId: string | null = null;
          for (const part of parts) {
            path = path ? `${path}/${part}` : part;
            if (!folders.has(path)) {
              const created = await createFolder.mutateAsync({ name: part, parentId });
              folders.set(path, created.id);
            }
            parentId = folders.get(path) ?? null;
          }
          const bucket = groups.get(path) ?? [];
          bucket.push(entry.file);
          groups.set(path, bucket);
        }
        for (const [path, group] of groups) uploaded.push(...await uploadDocuments.mutateAsync({ parentId: folders.get(path) ?? null, files: group }));
      } else {
        uploaded.push(...await uploadDocuments.mutateAsync({ parentId: null, files: list }));
      }
      for (const document of uploaded) {
        const item = await createItem.mutateAsync({ title: document.name.replace(/\.[^.]+$/, ""), categoryId: categoryId !== "all" && categoryId !== "archive" ? categoryId : null, kind: "fact", status: "captured" });
        await addSource.mutateAsync({ itemId: item.id, input: { type: "document", sourceTitle: document.name, documentId: document.id } });
      }
      setView("inbox");
      toast({ title: uploaded.length === 1 ? "Файл во входящих" : `Файлов во входящих: ${uploaded.length}`, tone: "success" });
    } catch (error) { reportError(error); }
    finally { if (fileInput.current) fileInput.current.value = ""; if (folderInput.current) folderInput.current.value = ""; }
  }

  function itemMenu(item: KnowledgeItem): Array<{ label: string; onSelect: () => void } | "separator"> {
    return [
      { label: "Открыть", onSelect: () => selectItem(item.id) },
      "separator",
      item.status === "archived"
        ? { label: "Вернуть из архива", onSelect: () => updateItem.mutate({ itemId: item.id, input: { status: "draft", expectedRevision: item.revision } }) }
        : { label: "В архив", onSelect: () => updateItem.mutate({ itemId: item.id, input: { status: "archived", expectedRevision: item.revision } }) }
    ];
  }

  const subtitle = view === "inbox" ? "Входящие — сырьё ждёт решения" : "Книги, документы и ссылки в свободных коллекциях";

  return (
    <PanelShell>
      <PanelBody className="[container-type:inline-size]">
        {items.isError ? (
          <EmptyState
            tone="danger"
            title="Список не загрузился"
            description="Связь с узлом прервалась. Повторите загрузку."
            action={<Button onClick={() => void items.refetch()}>Повторить</Button>}
          />
        ) : view === "reading" || view === "editing" ? (
          <>
            {view === "editing" ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                  <Button size="sm" variant="ghost" onClick={() => { if (editorDirty) { toast({ title: "Сначала сохраните материал", tone: "default" }); return; } setView("reading"); }}>
                    ← К чтению
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {selectedId ? (
                    <KnowledgeItemEditor
                      key={`${workspaceId}:${selectedId}`}
                      onDirtyChange={setEditorDirty}
                      workspaceId={workspaceId}
                      itemId={selectedId}
                      items={items.data ?? []}
                      categories={categories.data ?? []}
                      onOpenReading={() => {
                        if (editorDirty) { toast({ title: "Сначала сохраните материал", description: "В открытом материале есть несохранённые изменения.", tone: "default" }); return; }
                        setView("reading");
                      }}
                      onClosed={() => { setSelectedId(null); setEditorDirty(false); setView("library"); }}
                    />
                  ) : null}
                </div>
              </div>
            ) : detail.data ? (
              <KnowledgeReadingView
                item={detail.data}
                categories={categories.data ?? []}
                onBack={() => selectItem(null)}
                onEdit={() => setView("editing")}
                onOpenItem={(id) => selectItem(id)}
                menuItems={() => (detail.data ? itemMenu(detail.data) : [])}
              />
            ) : (
              <EmptyState icon={Library} title="Материал не найден" description="Возможно, его удалили. Вернитесь в библиотеку." action={<Button onClick={() => selectItem(null)}>В библиотеку</Button>} />
            )}
          </>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {/* Шапка (экраны 01/02) */}
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-1 pb-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#C9A86A14] text-[#C9A86A]">
                <BookOpen className="h-5 w-5" aria-hidden />
              </span>
              <div className="mr-auto min-w-0">
                <h1 className="text-[17px] font-semibold leading-tight text-foreground">База знаний</h1>
                <p className="truncate text-[12px] text-[#6E6A60]">{subtitle}</p>
              </div>
              <div className="relative w-full sm:w-[280px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6E6A60]" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "inbox" ? "Поиск по входящим" : "Поиск по тексту и источникам"} aria-label="Поиск" className="h-9 pl-8" />
              </div>
              <SegmentedControl
                aria-label="Вид базы знаний"
                value={view === "inbox" ? "inbox" : "library"}
                onChange={(next) => { setView(next as "library" | "inbox"); setInboxIndex(0); }}
                size="sm"
                options={[
                  { value: "library", label: "Библиотека" },
                  { value: "inbox", label: ribbonCounts.captured > 0 ? `Входящие ${ribbonCounts.captured}` : "Входящие" }
                ]}
              />
              <SegmentedControl
                aria-label="Вид списка"
                value={layout}
                onChange={(next) => setLayout(next as "grid" | "list")}
                size="sm"
                options={[
                  { value: "grid", label: <LayoutGrid className="h-3.5 w-3.5" aria-label="Сетка" /> },
                  { value: "list", label: <List className="h-3.5 w-3.5" aria-label="Список" /> }
                ]}
              />
              <div className="relative">
                <Button className="bg-[#C9A86A] text-[#1B1C1F] hover:bg-[#E7D7A8]" onClick={() => setAddMenu((open) => !open)} aria-expanded={addMenu}>
                  <Plus className="h-4 w-4" /> Добавить
                </Button>
                {addMenu ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-border bg-card p-1 shadow-lg" role="menu">
                    <AddMenuItem onClick={() => { setAddMenu(false); document.getElementById("knowledge-new-title")?.focus(); }}>Новый материал</AddMenuItem>
                    <AddMenuItem onClick={() => { setAddMenu(false); document.getElementById("knowledge-source-url")?.focus(); }}>Добавить ссылку</AddMenuItem>
                    {isEnabled("documents") ? (
                      <>
                        <AddMenuItem onClick={() => { setAddMenu(false); fileInput.current?.click(); }}>Импорт файлов</AddMenuItem>
                        <AddMenuItem onClick={() => { setAddMenu(false); folderInput.current?.click(); }}>Импорт папки</AddMenuItem>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>

            {/* Лента созревания */}
            <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-3">
              <StatusRibbon
                counts={ribbonCounts}
                active={statusFilter}
                onSelect={(status) => {
                  setStatusFilter(status);
                  if (view === "inbox" && status && status !== "captured") setView("library");
                }}
              />
              <div className="relative ml-auto">
                <Button size="sm" variant="ghost" aria-expanded={sortMenu} onClick={() => setSortMenu((open) => !open)}>
                  <ArrowUpDown className="h-3.5 w-3.5" /> Сортировка
                </Button>
                {sortMenu ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-border bg-card p-1 shadow-lg">
                    <label className="block px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-[#6E6A60]">Порядок</label>
                    {([["updated", "Недавно изменены"], ["created", "Сначала новые"], ["title", "По названию"]] as Array<[Sort, string]>).map(([value, label]) => (
                      <AddMenuItem key={value} onClick={() => { setSort(value); }}>
                        <span className={cx("flex items-center justify-between", sort === value ? "text-[#E7D7A8]" : "")}>{label}{sort === value ? "✓" : ""}</span>
                      </AddMenuItem>
                    ))}
                    <label className="block px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-[#6E6A60]">Тип</label>
                    <AddMenuItem onClick={() => setKindFilter("all")}><span className={cx("flex items-center justify-between", kindFilter === "all" ? "text-[#E7D7A8]" : "")}>Все типы{kindFilter === "all" ? "✓" : ""}</span></AddMenuItem>
                    {KNOWLEDGE_KINDS.map((kind) => (
                      <AddMenuItem key={kind} onClick={() => setKindFilter(kind)}><span className={cx("flex items-center justify-between", kindFilter === kind ? "text-[#E7D7A8]" : "")}>{KIND_LABEL[kind]}{kindFilter === kind ? "✓" : ""}</span></AddMenuItem>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Создание: скрытые поля-источники для меню «Добавить» */}
            <div className={cx("flex flex-wrap items-center gap-2 px-1 pt-2", sourceUrl || title ? "" : "hidden")}>
              <Input id="knowledge-new-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название материала" aria-label="Название нового материала" className="h-8 w-56" />
              <Button size="sm" disabled={createItem.isPending} onClick={() => { create(title); }}>Создать</Button>
              <Input id="knowledge-source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" aria-label="Адрес ссылки" className="h-8 w-64" />
              <Input value={sourceDescription} onChange={(event) => setSourceDescription(event.target.value)} placeholder="Описание (необязательно)" aria-label="Описание ссылки" className="h-8 w-52" />
              <Button size="sm" variant="outline" disabled={!sourceUrl.trim() || createItem.isPending} onClick={() => void importLink(sourceUrl, sourceDescription)}>Сохранить ссылку</Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 pt-3 [@container(min-width:900px)]:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="flex min-h-0 flex-col gap-2 [@container(max-width:899px)]:hidden">
                <CollectionSidebar categories={categories.data ?? []} counts={sidebarCounts} activeId={categoryId} onSelect={setCategoryId} />
                <form className="flex gap-2 border-t border-border pt-3" onSubmit={(event) => { event.preventDefault(); const name = sectionName.trim(); if (!name) return; const parentId = categoryId !== "all" && categoryId !== "archive" ? parentForNewSection(categoryId, categories.data ?? []) : null; void createCategory.mutateAsync({ name, parentId }).then(() => setSectionName("")).catch(reportError); }}>
                  <Input value={sectionName} onChange={(event) => setSectionName(event.target.value)} placeholder="Новая коллекция" aria-label="Название коллекции" className="h-8" />
                  <Button type="submit" size="sm" variant="outline" aria-label="Добавить коллекцию" disabled={!sectionName.trim() || createCategory.isPending}><FolderPlus className="h-4 w-4" /></Button>
                </form>
                {categoryId !== "all" && categoryId !== "archive" ? (
                  <Button size="sm" variant="ghost" className="self-start text-[#6E6A60]" onClick={() => void deleteCategory.mutateAsync(categoryId).then(() => setCategoryId("all")).catch(reportError)}>
                    Удалить коллекцию
                  </Button>
                ) : null}
              </aside>

              <section className="flex min-h-0 min-w-0 flex-col">
                {view === "inbox" ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <DropZone disabled={!isEnabled("documents") && false} onFiles={(files) => void importFiles(files)} onUrl={(url) => void importLink(url)} />
                    <div className="min-h-0 flex-1 space-y-3 overflow-auto" aria-label="Входящие">
                      {items.isLoading ? <p className="px-1 py-6 text-[13px] text-[#6E6A60]">Загрузка входящих…</p> : null}
                      {!items.isLoading && inboxVisible.length === 0 ? (
                        <EmptyState title="Входящие пусты" description="Перетащите файлы, вставьте ссылку — сырьё появится здесь." />
                      ) : null}
                      {inboxVisible.map((item, index) => (
                        <InboxRow
                          key={item.id}
                          item={item}
                          selected={index === Math.min(inboxIndex, inboxVisible.length - 1)}
                          onAccept={() => accept(item)}
                          onArchive={() => archive(item)}
                          onContextMenu={(event) => showContextMenu(event, itemMenu(item))}
                        />
                      ))}
                    </div>
                    <KbdBar />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-auto pb-2" aria-label="Материалы библиотеки">
                      {items.isLoading ? <p className="px-1 py-6 text-[13px] text-[#6E6A60]">Загрузка материалов…</p> : null}
                      {!items.isLoading && visible.length === 0 ? (
                        <EmptyState
                          title={query.trim() ? "Ничего не нашлось" : categoryId === "archive" ? "Архив пуст" : "Библиотека пуста"}
                          description={query.trim() ? "Смените запрос или снимите фильтры." : "Добавьте ссылку, файл или создайте материал кнопкой «Добавить»."}
                        />
                      ) : null}
                      {layout === "grid" ? (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [@container(min-width:1250px)]:grid-cols-3">
                          {visible.map((item) => (
                            <MaterialCard key={item.id} item={item} onOpen={() => selectItem(item.id)} onContextMenu={(event) => showContextMenu(event, itemMenu(item))} />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {visible.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => selectItem(item.id)}
                              onContextMenu={(event) => showContextMenu(event, itemMenu(item))}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            >
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{item.title}</span>
                              <span className="shrink-0 text-[11px] text-[#6E6A60]">{KIND_LABEL[item.kind]}</span>
                              <span className="shrink-0 font-mono text-[11px] text-[#6E6A60]">{relativeTime(item.updatedAt)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <footer className="flex items-center justify-between border-t border-border px-1 pt-3 font-mono text-[11px] text-[#6E6A60]">
                      <span>{visible.length} материалов в библиотеке</span>
                      <span>обновлено {visible[0] ? relativeTime(visible[0].updatedAt) : "—"}</span>
                    </footer>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(event) => void importFiles(event.target.files)} />
        <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden onChange={(event) => void importFiles(event.target.files, true)} />
      </PanelBody>
    </PanelShell>
  );
}

function AddMenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}

function categoryScope(selected: CollectionSelection, categories: KnowledgeCategory[]): Set<string> | null {
  if (selected === "all" || selected === "archive") return null;
  const ids = new Set<string>([selected]);
  for (const category of categories) if (category.parentId === selected) ids.add(category.id);
  return ids;
}

function parentForNewSection(selected: string, categories: KnowledgeCategory[]): string | null {
  const current = categories.find((category) => category.id === selected);
  if (!current) return null;
  return current.parentId ?? current.id;
}
