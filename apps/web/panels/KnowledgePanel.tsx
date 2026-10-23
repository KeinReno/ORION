"use client";

import {
  useAddKnowledgeRelation,
  useAddKnowledgeSource,
  useCreateKnowledgeCategory,
  useCreateKnowledgeItem,
  useDeleteKnowledgeCategory,
  useDeleteKnowledgeItem,
  useDeleteKnowledgeRelation,
  useDeleteKnowledgeSource,
  useKnowledgeCategories,
  useKnowledgeItem,
  useKnowledgeItems,
  useUpdateKnowledgeItem
} from "@orion/core-react";
import {
  KNOWLEDGE_RELATION_KINDS,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_VISIBILITIES,
  type KnowledgeItem,
  type KnowledgeRelationKind,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type KnowledgeVisibility
} from "@orion/shared-types";
import { Button, EmptyState, Input, PanelBody, PanelHeader, PanelShell, Textarea } from "@orion/ui";
import { useMemo, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  captured: "Сырьё",
  draft: "Черновик",
  review: "На проверке",
  approved: "Принято",
  published: "Опубликовано",
  archived: "Архив"
};

const VISIBILITY_LABEL: Record<KnowledgeVisibility, string> = {
  private: "Только я",
  workspace: "Пространство"
};

const SOURCE_LABEL: Record<KnowledgeSourceType, string> = {
  url: "Ссылка",
  note: "Заметка",
  document: "Документ",
  manual: "Запись",
  other: "Другое"
};

const RELATION_LABEL: Record<KnowledgeRelationKind, string> = {
  related: "Связано",
  expands: "Развивает",
  contradicts: "Противоречит",
  duplicate_of: "Дубликат",
  derived_from: "Выведено из",
  part_of: "Часть"
};

const fieldClass =
  "w-full rounded-lg border border-ui-border bg-ui-tint/[0.03] px-3 py-2 text-body text-ui-primary outline-none focus:border-ui-focus/70";

export function KnowledgePanel() {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | "all">("all");
  const [showArchived, setShowArchived] = useState(false);
  const categories = useKnowledgeCategories(workspaceId);
  const items = useKnowledgeItems(workspaceId, showArchived);
  const createCategory = useCreateKnowledgeCategory(workspaceId ?? "");
  const deleteCategory = useDeleteKnowledgeCategory(workspaceId ?? "");
  const createItem = useCreateKnowledgeItem(workspaceId ?? "");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      if (categoryId !== "all" && item.categoryId !== categoryId) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [items.data, query, categoryId]);

  if (!workspaceId) {
    return (
      <PanelShell>
        <PanelHeader title="База знаний" />
        <PanelBody>
          <EmptyState title="Нет пространства" description="Выберите пространство, чтобы открыть базу знаний." />
        </PanelBody>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <PanelHeader
        title="База знаний"
        subtitle="Материалы, источники и связи. Заметки остаются заметками."
        actions={
          <Button
            onClick={() => {
              const title = window.prompt("Название материала");
              if (!title?.trim()) return;
              void createItem
                .mutateAsync({ title: title.trim(), categoryId: categoryId === "all" ? null : categoryId })
                .then((item) => setSelectedId(item.id));
            }}
          >
            Новый материал
          </Button>
        }
      />
      <PanelBody>
        <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-3">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по названию, краткому тексту и тегам" />
            <div className="flex flex-wrap gap-1">
              <FilterChip active={categoryId === "all"} onClick={() => setCategoryId("all")}>
                Все
              </FilterChip>
              {(categories.data ?? []).map((category) => (
                <FilterChip key={category.id} active={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
                  {category.name}
                </FilterChip>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  const name = window.prompt("Название раздела");
                  if (!name?.trim()) return;
                  void createCategory.mutateAsync({ name: name.trim() });
                }}
              >
                Раздел
              </Button>
              {categoryId !== "all" ? (
                <Button variant="ghost" onClick={() => void deleteCategory.mutateAsync(categoryId).then(() => setCategoryId("all"))}>
                  Удалить раздел
                </Button>
              ) : null}
              <label className="ml-auto flex items-center gap-2 text-caption text-ui-muted">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                Архив
              </label>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto">
              {visible.length === 0 ? (
                <p className="px-1 py-6 text-caption text-ui-muted">Пока нет материалов.</p>
              ) : (
                visible.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left ${selectedId === item.id ? "bg-ui-tint/10" : "hover:bg-ui-tint/5"}`}
                  >
                    <div className="truncate text-body text-ui-primary">{item.title}</div>
                    <div className="truncate text-caption text-ui-muted">
                      {STATUS_LABEL[item.status]} · {VISIBILITY_LABEL[item.visibility]}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
          <section className="min-h-0 overflow-auto">
            {selectedId ? (
              <ItemEditor
                workspaceId={workspaceId}
                itemId={selectedId}
                items={items.data ?? []}
                categories={categories.data ?? []}
                onArchived={() => setSelectedId(null)}
              />
            ) : (
              <EmptyState title="Выберите материал" description="Или создайте новый. Источники хранятся отдельно от текста." />
            )}
          </section>
        </div>
      </PanelBody>
    </PanelShell>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-caption ${active ? "bg-ui-tint/15 text-ui-primary" : "text-ui-muted hover:bg-ui-tint/5"}`}
    >
      {children}
    </button>
  );
}

function ItemEditor({
  workspaceId,
  itemId,
  items,
  categories,
  onArchived
}: {
  workspaceId: string;
  itemId: string;
  items: KnowledgeItem[];
  categories: { id: string; name: string }[];
  onArchived: () => void;
}) {
  const detail = useKnowledgeItem(workspaceId, itemId);
  const update = useUpdateKnowledgeItem(workspaceId);
  const remove = useDeleteKnowledgeItem(workspaceId);
  const addSource = useAddKnowledgeSource(workspaceId);
  const deleteSource = useDeleteKnowledgeSource(workspaceId);
  const addRelation = useAddKnowledgeRelation(workspaceId);
  const deleteRelation = useDeleteKnowledgeRelation(workspaceId);
  const item = detail.data;
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>("url");
  const [relationTo, setRelationTo] = useState("");
  const [relationKind, setRelationKind] = useState<KnowledgeRelationKind>("related");

  if (!item) return <p className="text-caption text-ui-muted">Загрузка…</p>;

  const save = (patch: Parameters<typeof update.mutate>[0]["input"]) => update.mutate({ itemId, input: patch });

  return (
    <div className="space-y-4">
      <Input defaultValue={item.title} key={`${item.id}-title-${item.updatedAt}`} onBlur={(event) => save({ title: event.target.value.trim() || item.title })} />
      <div className="grid gap-2 sm:grid-cols-3">
        <select className={fieldClass} value={item.status} onChange={(event) => save({ status: event.target.value as KnowledgeStatus })}>
          {KNOWLEDGE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <select
          className={fieldClass}
          value={item.visibility}
          onChange={(event) => save({ visibility: event.target.value as KnowledgeVisibility })}
        >
          {KNOWLEDGE_VISIBILITIES.map((visibility) => (
            <option key={visibility} value={visibility}>
              {VISIBILITY_LABEL[visibility]}
            </option>
          ))}
        </select>
        <select
          className={fieldClass}
          value={item.categoryId ?? ""}
          onChange={(event) => save({ categoryId: event.target.value || null })}
        >
          <option value="">Без раздела</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        key={`${item.id}-summary-${item.updatedAt}`}
        defaultValue={item.summary}
        rows={2}
        placeholder="Кратко, своими словами"
        onBlur={(event) => save({ summary: event.target.value })}
      />
      <Textarea
        key={`${item.id}-body-${item.updatedAt}`}
        defaultValue={item.body}
        rows={10}
        placeholder="Редакционный текст. Источник — ниже, отдельно."
        onBlur={(event) => save({ body: event.target.value })}
      />
      <Input
        key={`${item.id}-tags-${item.updatedAt}`}
        defaultValue={item.tags.join(", ")}
        placeholder="Теги через запятую"
        onBlur={(event) =>
          save({
            tags: event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
              .slice(0, 20)
          })
        }
      />
      <div className="space-y-2 rounded-lg border border-ui-border p-3">
        <div className="text-body text-ui-primary">Источники</div>
        {item.sources.map((source) => (
          <div key={source.id} className="flex items-start justify-between gap-2 text-caption text-ui-muted">
            <div>
              <div>
                {SOURCE_LABEL[source.type]}
                {source.sourceTitle ? ` · ${source.sourceTitle}` : ""}
                {source.sourceUrl ? ` · ${source.sourceUrl}` : ""}
              </div>
              {source.originalText ? <div className="mt-1 whitespace-pre-wrap">{source.originalText}</div> : null}
            </div>
            <Button variant="ghost" onClick={() => deleteSource.mutate(source.id)}>
              Убрать
            </Button>
          </div>
        ))}
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={fieldClass} value={sourceType} onChange={(event) => setSourceType(event.target.value as KnowledgeSourceType)}>
            {KNOWLEDGE_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SOURCE_LABEL[type]}
              </option>
            ))}
          </select>
          <Input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Название источника" />
          <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="Адрес" />
          <Button
            onClick={() => {
              void addSource
                .mutateAsync({
                  itemId,
                  input: { type: sourceType, sourceTitle, sourceUrl, originalText: sourceText }
                })
                .then(() => {
                  setSourceTitle("");
                  setSourceUrl("");
                  setSourceText("");
                });
            }}
          >
            Добавить источник
          </Button>
        </div>
        <Textarea value={sourceText} rows={3} placeholder="Исходный текст, если его нужно сохранить" onChange={(event) => setSourceText(event.target.value)} />
      </div>
      <div className="space-y-2 rounded-lg border border-ui-border p-3">
        <div className="text-body text-ui-primary">Связи</div>
        {item.relations.map((relation) => {
          const other = items.find((candidate) => candidate.id === relation.toId);
          return (
            <div key={relation.id} className="flex items-center justify-between gap-2 text-caption text-ui-muted">
              <span>
                {RELATION_LABEL[relation.kind]} · {other?.title ?? relation.toId}
              </span>
              <Button variant="ghost" onClick={() => deleteRelation.mutate(relation.id)}>
                Убрать
              </Button>
            </div>
          );
        })}
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <select className={fieldClass} value={relationTo} onChange={(event) => setRelationTo(event.target.value)}>
            <option value="">Другой материал</option>
            {items
              .filter((candidate) => candidate.id !== item.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
          </select>
          <select className={fieldClass} value={relationKind} onChange={(event) => setRelationKind(event.target.value as KnowledgeRelationKind)}>
            {KNOWLEDGE_RELATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {RELATION_LABEL[kind]}
              </option>
            ))}
          </select>
          <Button
            disabled={!relationTo}
            onClick={() => {
              if (!relationTo) return;
              void addRelation.mutateAsync({ itemId, input: { toId: relationTo, kind: relationKind } }).then(() => setRelationTo(""));
            }}
          >
            Связать
          </Button>
        </div>
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          void remove.mutateAsync(itemId).then(onArchived);
        }}
      >
        {item.status === "archived" ? "Удалить навсегда" : "В архив"}
      </Button>
    </div>
  );
}
