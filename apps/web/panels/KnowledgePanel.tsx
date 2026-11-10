"use client";

import { KNOWLEDGE_KINDS, isKnowledgeInbox, type KnowledgeCategory, type KnowledgeItem, type KnowledgeKind } from "@orion/shared-types";
import { useAddKnowledgeSource, useCreateFolder, useCreateKnowledgeCategory, useCreateKnowledgeItem, useDeleteKnowledgeCategory, useKnowledgeCategories, useKnowledgeItems, useUpdateKnowledgeItem, useUploadDocuments } from "@orion/core-react";
import { Badge, Button, EmptyState, Input, PanelBody, PanelHeader, PanelShell, Select, SegmentedControl, cx, useContextMenuApi, useDebouncedValue, useToast } from "@orion/ui";
import JSZip from "jszip";
import { FileUp, FolderPlus, Library, Link2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { useKnowledgeFocusRequest } from "../lib/panel-bus";
import { KnowledgeItemEditor } from "./knowledge/item-editor";
import { KIND_ICON, KIND_LABEL, STATUS_LABEL, STATUS_TONE } from "./knowledge/knowledge-labels";
import { relativeTime } from "../lib/format";

type View = "library" | "inbox";
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

export function KnowledgePanel() {
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();
  const focusRequest = useKnowledgeFocusRequest();
  const reportError = (error: unknown) => toast({ title: "Не удалось выполнить действие", description: error instanceof Error ? error.message : "Попробуйте ещё раз.", tone: "danger" });
  const workspaceId = workspace?.id;
  const [view, setView] = useState<View>("library");
  const [editorDirty, setEditorDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [kindFilter, setKindFilter] = useState<KnowledgeKind | "all">("all");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const debounced = useDebouncedValue(query, 300);
  const categories = useKnowledgeCategories(workspaceId);
  const items = useKnowledgeItems(workspaceId, showArchived, debounced);
  const inbox = useKnowledgeItems(workspaceId, false, "");
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
    setView("library");
    setCategoryId("all");
    setShowArchived(false);
    setKindFilter("all");
    setQuery("");
    setSelectedId(focusRequest.id);
  }, [focusRequest, editorDirty, toast]);

  const inboxCount = (inbox.data ?? []).filter((item) => isKnowledgeInbox(item.status)).length;
  const visible = useMemo(() => {
    const ids = categoryScope(categoryId, categories.data ?? []);
    const filtered = (items.data ?? []).filter((item) => {
      if (ids && !ids.has(item.categoryId ?? "")) return false;
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (view === "inbox") return isKnowledgeInbox(item.status);
      if (item.status === "archived") return showArchived;
      return !isKnowledgeInbox(item.status);
    });
    return filtered.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ru") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
  }, [items.data, categories.data, categoryId, view, showArchived, sort, kindFilter]);

  if (!workspaceId) {
    return (
      <PanelShell>
        <PanelHeader icon={Library} title="База знаний" />
        <PanelBody className="[container-type:inline-size]">
          <EmptyState title="Нет пространства" description="Выберите пространство, чтобы открыть базу знаний." />
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
  }

  function create(name: string) {
    if (editorDirty) { selectItem(null); return; }
    const next = name.trim();
    if (!next) return;
    void createItem
      .mutateAsync({ title: next, categoryId: categoryId === "all" ? null : categoryId, status: "captured" })
      .then((item) => {
        setTitle("");
        setView("inbox");
        setSelectedId(item.id);
      }).catch(reportError);
  }

  async function importLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = sourceUrl.trim();
    if (!url) return;
    try {
      const item = await createItem.mutateAsync({
        title: url.replace(/^https?:\/\//, "").split(/[/?#]/)[0] || "Новая ссылка",
        summary: sourceDescription.trim(),
        categoryId: categoryId === "all" ? null : categoryId,
        kind: "link",
        status: "approved"
      });
      await addSource.mutateAsync({ itemId: item.id, input: { type: "url", sourceUrl: url, sourceTitle: url } });
      setSourceUrl("");
      setSourceDescription("");
      setSelectedId(item.id);
      toast({ title: "Ссылка добавлена в библиотеку", tone: "success" });
    } catch (error) { reportError(error); }
  }

  async function importFiles(files: FileList | null, folder = false) {
    if (!files?.length || !workspaceId) return;
    try {
      const expanded = await expandArchives([...files]);
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
        uploaded.push(...await uploadDocuments.mutateAsync({ parentId: null, files: [...files] }));
      }
      for (const document of uploaded) {
        const item = await createItem.mutateAsync({ title: document.name.replace(/\.[^.]+$/, ""), categoryId: categoryId === "all" ? null : categoryId, kind: "fact", status: "approved" });
        await addSource.mutateAsync({ itemId: item.id, input: { type: "document", sourceTitle: document.name, documentId: document.id } });
      }
      toast({ title: uploaded.length === 1 ? "Документ добавлен в библиотеку" : `Документов добавлено: ${uploaded.length}`, tone: "success" });
    } catch (error) { reportError(error); }
    finally { if (fileInput.current) fileInput.current.value = ""; if (folderInput.current) folderInput.current.value = ""; }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={Library}
        title="База знаний"
        subtitle="Книги, документы и ссылки — в свободных коллекциях. Проект не обязателен."
        actions={
          <SegmentedControl
            aria-label="Вид базы знаний"
            value={view}
            onChange={setView}
            options={[
              { value: "library", label: "Библиотека" },
              { value: "inbox", label: inboxCount > 0 ? `Входящие ${inboxCount}` : "Входящие" }
            ]}
          />
        }
      >
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по тексту, тегам и источникам" aria-label="Поиск" className="pl-8" />
        </div>
      </PanelHeader>
      <PanelBody className="[container-type:inline-size]">
        {items.isError ? (
          <EmptyState
            tone="danger"
            title="Список не загрузился"
            description="Связь с узлом прервалась. Повторите загрузку."
            action={<Button onClick={() => void items.refetch()}>Повторить</Button>}
          />
        ) : (
          <>
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => void importFiles(event.target.files)} />
          <input ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden onChange={(event) => void importFiles(event.target.files, true)} />
          <div className="grid h-full min-h-0 grid-cols-1 gap-3 [@container(min-width:800px)]:grid-cols-[14rem_minmax(16rem,21rem)_minmax(0,1fr)]">
            <aside className={cx("flex min-h-0 flex-col gap-3 border-b border-border pb-3 [@container(min-width:800px)]:border-b-0 [@container(min-width:800px)]:border-r [@container(min-width:800px)]:pr-3", selectedId && "[@container(max-width:799px)]:hidden")}>
              <div className="flex items-center justify-between px-1">
                <h2 className="text-label font-semibold text-foreground">Коллекции</h2>
                <Button size="sm" variant="ghost" aria-label="Создать коллекцию" title="Создать коллекцию" onClick={() => document.getElementById("knowledge-new-category")?.focus()}><FolderPlus className="h-4 w-4" /></Button>
              </div>
              <nav aria-label="Коллекции базы знаний" className="min-h-0 space-y-1 overflow-auto">
                <CollectionButton active={categoryId === "all"} count={(items.data ?? []).filter((item) => item.status !== "archived").length} onClick={() => setCategoryId("all")} label="Все материалы" />
                {(categories.data ?? []).map((category) => {
                  const count = (items.data ?? []).filter((item) => item.categoryId === category.id && item.status !== "archived").length;
                  return <CollectionButton key={category.id} active={categoryId === category.id} count={count} onClick={() => setCategoryId(category.id)} label={category.name} depth={category.parentId ? 1 : 0} />;
                })}
              </nav>
              <form className="flex gap-2 border-t border-border pt-3" onSubmit={(event) => { event.preventDefault(); const name = sectionName.trim(); if (!name) return; const parentId = categoryId === "all" ? null : parentForNewSection(categoryId, categories.data ?? []); void createCategory.mutateAsync({ name, parentId }).then(() => setSectionName("")).catch(reportError); }}>
                <Input id="knowledge-new-category" value={sectionName} onChange={(event) => setSectionName(event.target.value)} placeholder={categoryId === "all" ? "Новая коллекция" : "Подколлекция"} aria-label="Название коллекции" />
                <Button type="submit" size="sm" variant="outline" aria-label="Добавить коллекцию" disabled={!sectionName.trim() || createCategory.isPending}><Plus className="h-4 w-4" /></Button>
              </form>
              <form onSubmit={(event) => void importLink(event)} className="space-y-2 border-t border-border pt-3">
                <label className="text-label font-medium text-foreground" htmlFor="knowledge-source-url">Добавить ссылку</label>
                <Input id="knowledge-source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://github.com/…" />
                <Input value={sourceDescription} onChange={(event) => setSourceDescription(event.target.value)} placeholder="Краткое описание (необязательно)" aria-label="Краткое описание ссылки" />
                <Button type="submit" size="sm" variant="outline" disabled={!sourceUrl.trim() || createItem.isPending || addSource.isPending} className="w-full"><Link2 className="h-4 w-4" /> Сохранить ссылку</Button>
                {isEnabled("documents") ? <>
                  <Button type="button" size="sm" variant="ghost" className="w-full" disabled={uploadDocuments.isPending || createFolder.isPending} onClick={() => fileInput.current?.click()}><FileUp className="h-4 w-4" /> Файлы и ZIP-архивы</Button>
                  <Button type="button" size="sm" variant="ghost" className="w-full" disabled={uploadDocuments.isPending || createFolder.isPending} onClick={() => folderInput.current?.click()}><FolderPlus className="h-4 w-4" /> Импортировать папку</Button>
                </> : null}
              </form>
            </aside>
            <aside className={cx("flex min-h-0 flex-col gap-3", selectedId && "[@container(max-width:799px)]:hidden")}>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  create(title);
                }}
              >
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Новый материал" aria-label="Название нового материала" />
                <Button type="submit" size="sm" disabled={!title.trim() || createItem.isPending}>
                  <Plus className="h-4 w-4" /> Создать
                </Button>
              </form>
              <div className="flex flex-wrap items-center gap-2 text-label">
                <span className="text-label font-semibold text-foreground">Материалы <span className="font-normal text-subtle-foreground">{visible.length}</span></span>
                <Select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Сортировка материалов" className="ml-auto max-w-44">
                  <option value="updated">Недавно изменены</option><option value="created">Сначала новые</option><option value="title">По названию</option>
                </Select>
                <Select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KnowledgeKind | "all")} aria-label="Фильтр по типу материала" className="max-w-40">
                  <option value="all">Все типы</option>{KNOWLEDGE_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>)}
                </Select>
                {categoryId !== "all" ? (
                  <Button size="sm" variant="ghost" onClick={() => void deleteCategory.mutateAsync(categoryId).then(() => setCategoryId("all")).catch(reportError)}>
                    Удалить раздел
                  </Button>
                ) : null}
                {view === "library" ? (
                  <label className="flex items-center gap-2 text-label text-subtle-foreground">
                    <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-accent" />
                    Архив
                  </label>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto" aria-label="Список материалов">
                {items.isLoading ? <p className="px-1 py-6 text-label text-subtle-foreground">Загрузка материалов…</p> : null}
                {!items.isLoading && visible.length === 0 ? (
                  <EmptyState
                    title={query.trim() ? "Ничего не нашлось" : view === "inbox" ? "Входящие пусты" : "Библиотека пуста"}
                    description={
                      query.trim()
                        ? "Смените запрос или вид."
                        : view === "inbox"
                          ? "Сырьё и материалы на проверке появятся здесь."
                          : "Создайте первый материал — название уже в поле выше."
                    }
                  />
                ) : null}
                {visible.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    onOpen={() => selectItem(item.id)}
                    onContextMenu={(event) =>
                      showContextMenu(event, [
                        { label: "Открыть", onSelect: () => selectItem(item.id) },
                        "separator",
                        item.status === "archived"
                          ? { label: "Вернуть из архива", onSelect: () => updateItem.mutate({ itemId: item.id, input: { status: "draft", expectedRevision: item.revision } }) }
                          : { label: "В архив", onSelect: () => updateItem.mutate({ itemId: item.id, input: { status: "archived", expectedRevision: item.revision } }) }
                      ])
                    }
                    onAccept={
                      view === "inbox"
                        ? () => updateItem.mutate({ itemId: item.id, input: { status: "approved", expectedRevision: item.revision } })
                        : undefined
                    }
                    onArchive={
                      view === "inbox"
                        ? () => updateItem.mutate({ itemId: item.id, input: { status: "archived", expectedRevision: item.revision } })
                        : undefined
                    }
                  />
                ))}
              </div>
            </aside>
            <section className={cx("min-h-0 min-w-0 overflow-auto", !selectedId && "[@container(max-width:799px)]:hidden")}>
              {selectedId ? <Button variant="ghost" size="sm" className="mb-3 [@container(min-width:800px)]:hidden" onClick={() => selectItem(null)}>← К списку материалов</Button> : null}
              {selectedId ? (
                <KnowledgeItemEditor
                  key={`${workspaceId}:${selectedId}`}
                  onDirtyChange={setEditorDirty}
                  workspaceId={workspaceId}
                  itemId={selectedId}
                  items={inbox.data ?? items.data ?? []}
                  categories={categories.data ?? []}
                  onClosed={() => { setSelectedId(null); setEditorDirty(false); }}
                />
              ) : (
                <EmptyState icon={Library} title="Выберите материал" description="Слева — список. Источник открытого материала остаётся отдельно от текста." />
              )}
            </section>
          </div>
          </>
        )}
      </PanelBody>
    </PanelShell>
  );
}

function categoryScope(selected: string | "all", categories: KnowledgeCategory[]): Set<string> | null {
  if (selected === "all") return null;
  const ids = new Set<string>([selected]);
  for (const category of categories) if (category.parentId === selected) ids.add(category.id);
  return ids;
}

function parentForNewSection(selected: string, categories: KnowledgeCategory[]): string | null {
  const current = categories.find((category) => category.id === selected);
  if (!current) return null;
  return current.parentId ?? current.id;
}

function CollectionButton({ active, count, label, depth = 0, onClick }: { active: boolean; count: number; label: string; depth?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", active ? "bg-accent/10 text-accent-text" : "text-muted-foreground")} style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <Library className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-micro text-subtle-foreground">{count}</span>
    </button>
  );
}

function ItemRow({
  item,
  selected,
  onOpen,
  onContextMenu,
  onAccept,
  onArchive
}: {
  item: KnowledgeItem;
  selected: boolean;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onAccept?: () => void;
  onArchive?: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  return (
    <div onContextMenu={onContextMenu} className={cx("rounded-md px-2 py-2 transition-colors", selected ? "bg-accent/10" : "hover:bg-card-hover")}>
      <button type="button" onClick={onOpen} aria-current={selected ? "true" : undefined} className="w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <p className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground">{item.title}</span>
          <span className="shrink-0 text-micro text-subtle-foreground">{relativeTime(item.updatedAt)}</span>
        </p>
        {item.summary.trim() ? <p className="mt-1 line-clamp-2 pl-5 text-label text-muted-foreground">{item.summary}</p> : null}
        <p className="mt-1 flex items-center gap-1.5 pl-5">
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          <span className="text-micro text-subtle-foreground">{KIND_LABEL[item.kind]}</span>
        </p>
      </button>
      {onAccept || onArchive ? (
        <div className="mt-2 flex gap-2 pl-5">
          {onAccept ? (
            <Button size="sm" variant="outline" onClick={onAccept}>
              Принять
            </Button>
          ) : null}
          {onArchive ? (
            <Button size="sm" variant="ghost" onClick={onArchive}>
              В архив
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
