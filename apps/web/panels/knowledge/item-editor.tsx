"use client";

import { ApiError } from "@orion/core";
import {
  useAddKnowledgeRelation,
  useAddKnowledgeSource,
  useDeleteKnowledgeItem,
  useDeleteKnowledgeRelation,
  useDeleteKnowledgeSource,
  useDocuments,
  useKnowledgeItem,
  useNotes,
  useUpdateKnowledgeItem
} from "@orion/core-react";
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_RELATION_KINDS,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  type KnowledgeCategory,
  type KnowledgeItem,
  type KnowledgeItemDetail,
  type KnowledgeKind,
  type KnowledgeRelationKind,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type KnowledgeVisibility
} from "@orion/shared-types";
import { Button, Input, MarkdownEditor, Select, Textarea, useToast } from "@orion/ui";
import { useEffect, useRef, useState } from "react";

const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  captured: "Сырьё",
  draft: "Черновик",
  review: "На проверке",
  approved: "Принято",
  published: "Опубликовано",
  archived: "Архив"
};

const KIND_LABEL: Record<KnowledgeKind, string> = {
  method: "Методика",
  tool: "Инструмент",
  fact: "Факт",
  opinion: "Мнение",
  link: "Ссылка"
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

interface Draft {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  kind: KnowledgeKind;
  categoryId: string | null;
  tags: string;
  revision: number;
}

function fromDetail(item: KnowledgeItemDetail): Draft {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    body: item.body,
    status: item.status,
    visibility: item.visibility,
    kind: item.kind,
    categoryId: item.categoryId,
    tags: item.tags.join(", "),
    revision: item.revision
  };
}

function conflictOf(error: unknown): KnowledgeItemDetail | null {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.details || typeof error.details !== "object") return null;
  const details = error.details as { code?: string; current?: KnowledgeItemDetail };
  if (details.code !== "knowledge_revision_conflict" || !details.current?.id) return null;
  return details.current;
}

export function KnowledgeItemEditor({
  workspaceId,
  itemId,
  items,
  categories,
  onClosed
}: {
  workspaceId: string;
  itemId: string;
  items: KnowledgeItem[];
  categories: KnowledgeCategory[];
  onClosed: () => void;
}) {
  const detail = useKnowledgeItem(workspaceId, itemId);
  const update = useUpdateKnowledgeItem(workspaceId);
  const remove = useDeleteKnowledgeItem(workspaceId);
  const deleteSource = useDeleteKnowledgeSource(workspaceId);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState<KnowledgeItemDetail | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const queued = useRef(false);
  draftRef.current = draft;

  useEffect(() => {
    if (!detail.data) return;
    setDraft((current) => {
      if (current && current.id === detail.data?.id) return current;
      dirty.current = false;
      return fromDetail(detail.data);
    });
  }, [detail.data]);

  function edit(patch: Partial<Draft>) {
    dirty.current = true;
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    const snapshot = draftRef.current;
    if (!snapshot || conflict) return;
    if (saving.current) {
      queued.current = true;
      return;
    }
    saving.current = true;
    const tags = snapshot.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
    try {
      const saved = await update.mutateAsync({
        itemId: snapshot.id,
        input: {
          title: snapshot.title.trim() || "Без названия",
          summary: snapshot.summary,
          body: snapshot.body,
          status: snapshot.status,
          visibility: snapshot.visibility,
          kind: snapshot.kind,
          categoryId: snapshot.categoryId,
          tags,
          expectedRevision: snapshot.revision
        }
      });
      setConflict(null);
      setDraft((current) => {
        if (!current || current.id !== saved.id) return fromDetail(saved);
        const changed =
          current.title !== snapshot.title ||
          current.summary !== snapshot.summary ||
          current.body !== snapshot.body ||
          current.tags !== snapshot.tags ||
          current.status !== snapshot.status ||
          current.visibility !== snapshot.visibility ||
          current.kind !== snapshot.kind ||
          current.categoryId !== snapshot.categoryId;
        return changed ? { ...current, revision: saved.revision } : fromDetail(saved);
      });
    } catch (error) {
      const current = conflictOf(error);
      if (current) setConflict(current);
      else {
        toast({
          title: "Не удалось сохранить материал",
          description: error instanceof ApiError ? error.message : "Повторите сохранение. Набранный текст на месте.",
          tone: "danger"
        });
      }
    } finally {
      saving.current = false;
      if (queued.current) {
        queued.current = false;
        void save();
      }
    }
  }

  useEffect(() => {
    if (!dirty.current || conflict) return;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, conflict]);

  if (detail.isError) {
    return (
      <div className="space-y-3">
        <p className="text-body text-ui-primary">Материал не загрузился.</p>
        <Button onClick={() => void detail.refetch()}>Повторить</Button>
      </div>
    );
  }
  if (!draft || !detail.data) return <p className="text-caption text-ui-muted">Загрузка материала…</p>;

  const item = detail.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
      <aside className="space-y-3">
        <h2 className="text-body text-ui-primary">Источник</h2>
        {item.sources.map((source) => (
          <div key={source.id} className="space-y-1 rounded-lg border border-ui-border p-3 text-caption text-ui-muted">
            <div className="text-ui-primary">
              {SOURCE_LABEL[source.type]}
              {source.sourceTitle ? ` · ${source.sourceTitle}` : ""}
            </div>
            {source.sourceUrl ? <div className="break-all">{source.sourceUrl}</div> : null}
            {source.originalText ? <div className="whitespace-pre-wrap">{source.originalText}</div> : null}
            <Button variant="ghost" onClick={() => deleteSource.mutate(source.id)}>
              Убрать источник
            </Button>
          </div>
        ))}
        <SourceForm workspaceId={workspaceId} itemId={item.id} />
      </aside>
      <div className="min-w-0 space-y-3">
        {conflict ? (
          <div className="space-y-2 rounded-lg border border-ui-border p-3">
            <p className="text-body text-ui-primary">Материал сохранился в другой версии. Ваш текст на месте.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setDraft(fromDetail(conflict));
                  setConflict(null);
                  dirty.current = false;
                }}
              >
                Загрузить версию сервера
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft((current) => (current ? { ...current, revision: conflict.revision } : current));
                  setConflict(null);
                  dirty.current = true;
                  window.setTimeout(() => void save(), 0);
                }}
              >
                Сохранить мою поверх
              </Button>
            </div>
          </div>
        ) : null}
        <Input value={draft.title} onChange={(event) => edit({ title: event.target.value })} aria-label="Название" />
        <Textarea value={draft.summary} rows={2} placeholder="Кратко, своими словами" onChange={(event) => edit({ summary: event.target.value })} />
        <MarkdownEditor value={draft.body} onChange={(body) => edit({ body })} onSave={() => void save()} placeholder="Редакционный текст" />
        <Relations item={item} items={items} workspaceId={workspaceId} />
        <div className="flex flex-wrap gap-2">
          {item.status === "archived" ? (
            <Button variant="outline" onClick={() => edit({ status: "draft" })}>
              Вернуть из архива
            </Button>
          ) : (
            <Button variant="outline" onClick={() => edit({ status: "archived" })}>
              В архив
            </Button>
          )}
          {item.status === "archived" ? (
            <Button
              variant="danger"
              onClick={() => {
                void remove.mutateAsync(item.id).then(onClosed);
              }}
            >
              Удалить навсегда
            </Button>
          ) : null}
        </div>
      </div>
      <aside className="space-y-3">
        <label className="block space-y-1 text-caption text-ui-muted">
          Статус
          <Select value={draft.status} onChange={(event) => edit({ status: event.target.value as KnowledgeStatus })}>
            {KNOWLEDGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </label>
        <div className="space-y-1 text-caption text-ui-muted">
          Видимость
          <div className="flex gap-2">
            <Button variant={draft.visibility === "private" ? "primary" : "outline"} onClick={() => edit({ visibility: "private" })}>
              Только я
            </Button>
            <Button variant={draft.visibility === "workspace" ? "primary" : "outline"} onClick={() => edit({ visibility: "workspace" })}>
              Пространство
            </Button>
          </div>
        </div>
        <label className="block space-y-1 text-caption text-ui-muted">
          Тип
          <Select value={draft.kind} onChange={(event) => edit({ kind: event.target.value as KnowledgeKind })}>
            {KNOWLEDGE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1 text-caption text-ui-muted">
          Раздел
          <Select value={draft.categoryId ?? ""} onChange={(event) => edit({ categoryId: event.target.value || null })}>
            <option value="">Без раздела</option>
            {categories
              .filter((category) => !category.parentId)
              .map((category) => (
                <optgroup key={category.id} label={category.name}>
                  <option value={category.id}>{category.name}</option>
                  {categories
                    .filter((child) => child.parentId === category.id)
                    .map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </Select>
        </label>
        <label className="block space-y-1 text-caption text-ui-muted">
          Теги
          <Input value={draft.tags} placeholder="через запятую" onChange={(event) => edit({ tags: event.target.value })} />
        </label>
      </aside>
    </div>
  );

}

function SourceForm({ workspaceId, itemId }: { workspaceId: string; itemId: string }) {
  const addSource = useAddKnowledgeSource(workspaceId);
  const [type, setType] = useState<KnowledgeSourceType>("url");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [noteId, setNoteId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const notes = useNotes(type === "note" ? workspaceId : undefined);
  const documents = useDocuments(type === "document" ? workspaceId : undefined);
  const { toast } = useToast();

  return (
    <div className="space-y-2">
      <Select value={type} onChange={(event) => setType(event.target.value as KnowledgeSourceType)} aria-label="Тип источника">
        {KNOWLEDGE_SOURCE_TYPES.map((item) => (
          <option key={item} value={item}>
            {SOURCE_LABEL[item]}
          </option>
        ))}
      </Select>
      {type === "note" ? (
        <Select value={noteId} onChange={(event) => setNoteId(event.target.value)} aria-label="Заметка">
          <option value="">Заметка</option>
          {(notes.data ?? []).map((note) => (
            <option key={note.id} value={note.id}>
              {note.title}
            </option>
          ))}
        </Select>
      ) : null}
      {type === "document" ? (
        <Select value={documentId} onChange={(event) => setDocumentId(event.target.value)} aria-label="Документ">
          <option value="">Документ</option>
          {(documents.data ?? [])
            .filter((document) => document.kind === "file")
            .map((document) => (
              <option key={document.id} value={document.id}>
                {document.name}
              </option>
            ))}
        </Select>
      ) : null}
      {type === "url" || type === "other" || type === "manual" ? (
        <Input value={url} placeholder="Адрес" onChange={(event) => setUrl(event.target.value)} />
      ) : null}
      <Input value={title} placeholder="Название источника" onChange={(event) => setTitle(event.target.value)} />
      <Textarea value={text} rows={4} placeholder="Исходный текст" onChange={(event) => setText(event.target.value)} />
      <Button
        onClick={() => {
          void addSource
            .mutateAsync({
              itemId,
              input: { type, sourceTitle: title, sourceUrl: url, originalText: text, noteId: noteId || null, documentId: documentId || null }
            })
            .then(() => {
              setTitle("");
              setUrl("");
              setText("");
              setNoteId("");
              setDocumentId("");
            })
            .catch((error: unknown) => {
              toast({
                title: "Источник не добавился",
                description: error instanceof ApiError ? error.message : "Текст источника остался в полях.",
                tone: "danger"
              });
            });
        }}
      >
        Добавить источник
      </Button>
    </div>
  );
}

function Relations({ item, items, workspaceId }: { item: KnowledgeItemDetail; items: KnowledgeItem[]; workspaceId: string }) {
  const addRelation = useAddKnowledgeRelation(workspaceId);
  const deleteRelation = useDeleteKnowledgeRelation(workspaceId);
  const [toId, setToId] = useState("");
  const [kind, setKind] = useState<KnowledgeRelationKind>("related");
  return (
    <div className="space-y-2">
      <h2 className="text-body text-ui-primary">Связи</h2>
      {item.relations.map((relation) => (
        <div key={relation.id} className="flex items-center justify-between gap-2 text-caption text-ui-muted">
          <span>
            {RELATION_LABEL[relation.kind]} · {relation.peerTitle}
          </span>
          <Button variant="ghost" onClick={() => deleteRelation.mutate(relation.id)}>
            Убрать связь
          </Button>
        </div>
      ))}
      {item.backlinks.length > 0 ? <h3 className="text-caption text-ui-muted">На это ссылаются</h3> : null}
      {item.backlinks.map((relation) => (
        <div key={relation.id} className="text-caption text-ui-muted">
          {relation.peerTitle} · {RELATION_LABEL[relation.kind]}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <Select value={toId} onChange={(event) => setToId(event.target.value)} aria-label="Другой материал">
          <option value="">Другой материал</option>
          {items
            .filter((candidate) => candidate.id !== item.id)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
        </Select>
        <Select value={kind} onChange={(event) => setKind(event.target.value as KnowledgeRelationKind)} aria-label="Вид связи">
          {KNOWLEDGE_RELATION_KINDS.map((itemKind) => (
            <option key={itemKind} value={itemKind}>
              {RELATION_LABEL[itemKind]}
            </option>
          ))}
        </Select>
        <Button
          disabled={!toId}
          onClick={() => {
            if (!toId) return;
            void addRelation.mutateAsync({ itemId: item.id, input: { toId, kind } }).then(() => setToId(""));
          }}
        >
          Связать
        </Button>
      </div>
    </div>
  );
}
