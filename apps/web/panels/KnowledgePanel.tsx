"use client";

import { useCreateKnowledgeCategory, useCreateKnowledgeItem, useDeleteKnowledgeCategory, useKnowledgeCategories, useKnowledgeItems, useUpdateKnowledgeItem } from "@orion/core-react";
import { isKnowledgeInbox, type KnowledgeCategory, type KnowledgeItem, type KnowledgeStatus } from "@orion/shared-types";
import { Button, EmptyState, Input, PanelBody, PanelHeader, PanelShell, SegmentedControl, useDebouncedValue, useToast } from "@orion/ui";
import { useMemo, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { KnowledgeItemEditor } from "./knowledge/item-editor";

type View = "library" | "inbox";

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  captured: "Сырьё",
  draft: "Черновик",
  review: "На проверке",
  approved: "Принято",
  published: "Опубликовано",
  archived: "Архив"
};

export function KnowledgePanel() {
  const { workspace } = useActiveWorkspace();
  const { toast } = useToast();
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
  const debounced = useDebouncedValue(query, 300);
  const categories = useKnowledgeCategories(workspaceId);
  const items = useKnowledgeItems(workspaceId, showArchived, debounced);
  const inbox = useKnowledgeItems(workspaceId, false, "");
  const createCategory = useCreateKnowledgeCategory(workspaceId ?? "");
  const deleteCategory = useDeleteKnowledgeCategory(workspaceId ?? "");
  const createItem = useCreateKnowledgeItem(workspaceId ?? "");
  const updateItem = useUpdateKnowledgeItem(workspaceId ?? "");

  const inboxCount = (inbox.data ?? []).filter((item) => isKnowledgeInbox(item.status)).length;
  const visible = useMemo(() => {
    const ids = categoryScope(categoryId, categories.data ?? []);
    return (items.data ?? []).filter((item) => {
      if (ids && !ids.has(item.categoryId ?? "")) return false;
      if (view === "inbox") return isKnowledgeInbox(item.status);
      if (item.status === "archived") return showArchived;
      return !isKnowledgeInbox(item.status);
    });
  }, [items.data, categories.data, categoryId, view, showArchived]);

  if (!workspaceId) {
    return (
      <PanelShell>
        <PanelHeader title="База знаний" />
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

  return (
    <PanelShell>
      <PanelHeader
        title="База знаний"
        subtitle="Готовое знание отдельно от заметок. Источник остаётся рядом с текстом."
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
      />
      <PanelBody className="[container-type:inline-size]">
        {items.isError ? (
          <EmptyState
            tone="danger"
            title="Список не загрузился"
            description="Связь с узлом прервалась. Повторите загрузку."
            action={<Button onClick={() => void items.refetch()}>Повторить</Button>}
          />
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 [@container(min-width:800px)]:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className={`flex min-h-0 flex-col gap-3 ${selectedId ? "[@container(max-width:799px)]:hidden" : ""}`}>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  create(title);
                }}
              >
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Новый материал" aria-label="Название нового материала" />
                <Button type="submit" disabled={!title.trim() || createItem.isPending}>
                  Создать
                </Button>
              </form>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по тексту, тегам и источникам" aria-label="Поиск" />
              <div className="flex flex-wrap gap-1">
                <FilterChip active={categoryId === "all"} onClick={() => setCategoryId("all")}>
                  Все
                </FilterChip>
                {(categories.data ?? [])
                  .filter((category) => !category.parentId)
                  .map((category) => (
                    <span key={category.id} className="contents">
                      <FilterChip active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
                        {category.name}
                      </FilterChip>
                      {(categories.data ?? [])
                        .filter((child) => child.parentId === category.id)
                        .map((child) => (
                          <FilterChip key={child.id} active={categoryId === child.id} onClick={() => setCategoryId(child.id)}>
                            {child.name}
                          </FilterChip>
                        ))}
                    </span>
                  ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = sectionName.trim();
                  if (!name) return;
                  const parentId = categoryId === "all" ? null : parentForNewSection(categoryId, categories.data ?? []);
                  void createCategory.mutateAsync({ name, parentId }).then(() => setSectionName("")).catch(reportError);
                }}
              >
                <Input
                  value={sectionName}
                  onChange={(event) => setSectionName(event.target.value)}
                  placeholder={categoryId === "all" ? "Новый раздел" : "Подраздел"}
                  aria-label="Название раздела"
                />
                <Button type="submit" variant="outline" disabled={!sectionName.trim() || createCategory.isPending}>
                  Раздел
                </Button>
              </form>
              <div className="flex flex-wrap gap-2">
                {categoryId !== "all" ? (
                  <Button variant="ghost" onClick={() => void deleteCategory.mutateAsync(categoryId).then(() => setCategoryId("all")).catch(reportError)}>
                    Удалить раздел
                  </Button>
                ) : null}
                {view === "library" ? (
                  <label className="ml-auto flex items-center gap-2 text-caption text-ui-muted">
                    <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                    Архив
                  </label>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-auto">
                {items.isLoading ? <p className="px-1 py-6 text-caption text-ui-muted">Загрузка материалов…</p> : null}
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
            <section className={`min-h-0 min-w-0 overflow-auto ${!selectedId ? "[@container(max-width:799px)]:hidden" : ""}`}>
              {selectedId ? <Button variant="ghost" className="mb-3 [@container(min-width:800px)]:hidden" onClick={() => selectItem(null)}>← К списку материалов</Button> : null}
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
                <EmptyState title="Выберите материал" description="Слева — список. Источник открытого материала остаётся отдельно от текста." />
              )}
            </section>
          </div>
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

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-caption ${active ? "bg-ui-tint/15 text-ui-primary" : "text-ui-muted hover:bg-ui-tint/5"}`}
    >
      {children}
    </button>
  );
}

function ItemRow({
  item,
  selected,
  onOpen,
  onAccept,
  onArchive
}: {
  item: KnowledgeItem;
  selected: boolean;
  onOpen: () => void;
  onAccept?: () => void;
  onArchive?: () => void;
}) {
  return (
    <div className={`rounded-lg px-3 py-2 ${selected ? "bg-ui-tint/10" : "hover:bg-ui-tint/5"}`}>
      <button type="button" onClick={onOpen} aria-current={selected ? "true" : undefined} className="w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <div className="truncate text-body text-ui-primary">{item.title}</div>
        <div className="truncate text-caption text-ui-muted">{STATUS_LABEL[item.status]}</div>
      </button>
      {onAccept || onArchive ? (
        <div className="mt-2 flex gap-2">
          {onAccept ? (
            <Button variant="outline" onClick={onAccept}>
              Принять
            </Button>
          ) : null}
          {onArchive ? (
            <Button variant="ghost" onClick={onArchive}>
              В архив
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
