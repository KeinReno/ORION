"use client";

import { useUnsavedDraft } from "../../lib/unsaved-drafts";
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
  useProjects,
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
import { Badge, Button, ConfirmDialog, DropdownMenu, Input, MarkdownEditor, Select, Sheet, Textarea, useToast } from "@orion/ui";
import { BookOpen, Check, ChevronDown, Library, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KIND_ICON, KIND_LABEL, RELATION_LABEL, SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, VISIBILITY_LABEL } from "./knowledge-labels";
import { useEnabledModules } from "../../lib/use-enabled-modules";
import { openEntity } from "../../lib/panel-bus";

interface Draft {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  kind: KnowledgeKind;
  categoryId: string | null;
  projectId: string | null;
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
    projectId: item.projectId,
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

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

/**
 * ORION-19: the material's text is the surface now, not one of three equal columns. Status/kind/
 * visibility live in one chip row (same quick-change pattern as `ProjectStatusMenu`), source and
 * relations moved into a "Контекст" sheet opened on demand — the task doc's own words, "атрибуты
 * доступны по контексту без обязательных выдвижных панелей". «Режим чтения» (`KnowledgeReadingView`)
 * is a separate, distraction-free render, not a CSS tweak on this one — editing chrome has no
 * business being present while reading something straight through.
 */
export function KnowledgeItemEditor({
  workspaceId,
  itemId,
  items,
  categories,
  onClosed,
  onDirtyChange,
  onOpenReading
}: {
  workspaceId: string;
  itemId: string;
  items: KnowledgeItem[];
  categories: KnowledgeCategory[];
  onClosed: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Панель владеет экраном чтения (экран 03): редактор просит её вместо встроенного режима. */
  onOpenReading?: () => void;
}) {
  const detail = useKnowledgeItem(workspaceId, itemId);
  const { isEnabled } = useEnabledModules();
  const projects = useProjects(isEnabled("projects") ? workspaceId : undefined);
  const update = useUpdateKnowledgeItem(workspaceId);
  const remove = useDeleteKnowledgeItem(workspaceId);
  const deleteSource = useDeleteKnowledgeSource(workspaceId);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState<KnowledgeItemDetail | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const draftRef = useRef<Draft | null>(null);
  const dirty = useRef(false);
  const [unsaved, setUnsaved] = useState(false);
  useUnsavedDraft(unsaved);
  useEffect(() => { onDirtyChange(unsaved); }, [unsaved, onDirtyChange]);
  const saveRef = useRef<() => Promise<void>>(async () => {});
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
    setUnsaved(true);
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
    dirty.current = false;
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
          projectId: snapshot.projectId,
          tags,
          expectedRevision: snapshot.revision
        }
      });
      setConflict(null);
      const current = draftRef.current;
      if (current && current.id === saved.id) {
        const changed =
          current.title !== snapshot.title ||
          current.summary !== snapshot.summary ||
          current.body !== snapshot.body ||
          current.tags !== snapshot.tags ||
          current.status !== snapshot.status ||
          current.visibility !== snapshot.visibility ||
          current.kind !== snapshot.kind ||
          current.categoryId !== snapshot.categoryId ||
          current.projectId !== snapshot.projectId;
        setUnsaved(changed);
        const next = changed ? { ...current, revision: saved.revision } : fromDetail(saved);
        draftRef.current = next;
        setDraft(next);
      }
    } catch (error) {
      queued.current = false;
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
        void saveRef.current();
      }
    }
  }
  saveRef.current = save;

  useEffect(() => {
    if (!dirty.current || conflict) return;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      void saveRef.current();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, conflict]);

  if (detail.isError) {
    return (
      <div className="space-y-3">
        <p className="text-body text-foreground">Материал не загрузился.</p>
        <Button onClick={() => void detail.refetch()}>Повторить</Button>
      </div>
    );
  }
  if (!draft || !detail.data) return <p className="text-label text-subtle-foreground">Загрузка материала…</p>;

  const item = detail.data;
  const contextCount = item.sources.length + item.relations.length + item.backlinks.length + (item.projectId ? 1 : 0);


  return (
    <div className="min-w-0 space-y-4">
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить материал навсегда?"
        description="Текст, источники и связи будут удалены. Восстановить их нельзя."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (remove.isPending) return;
          void remove.mutateAsync(item.id).then(onClosed).catch(() => {
            toast({ title: "Не удалось удалить материал", tone: "danger" });
            setConfirmDelete(false);
          });
        }}
      />

      {conflict ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <p className="text-body text-foreground">Материал сохранился в другой версии. Ваш текст на месте.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setDraft(fromDetail(conflict));
                setConflict(null);
                dirty.current = false;
                setUnsaved(false);
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
              }}
            >
              Сохранить мою поверх
            </Button>
          </div>
        </div>
      ) : null}

      {/* The one chip row every density elsewhere in ORION uses for quick state changes — not a
          permanently-visible column of labelled <Select>s. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <KnowledgeStatusMenu status={draft.status} onChange={(status) => edit({ status })} />
        <KnowledgeKindMenu kind={draft.kind} onChange={(kind) => edit({ kind })} />
        <KnowledgeVisibilityMenu visibility={draft.visibility} onChange={(visibility) => edit({ visibility })} />
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => (onOpenReading ? onOpenReading() : undefined)} disabled={!draft.body.trim()} title={!draft.body.trim() ? "В материале пока нет текста" : undefined}>
          <BookOpen className="h-3.5 w-3.5" /> Режим чтения
        </Button>
        <Button size="sm" variant="outline" onClick={() => setContextOpen(true)}>
          <Library className="h-3.5 w-3.5" /> Контекст{contextCount > 0 ? ` · ${contextCount}` : ""}
        </Button>
      </div>

      <Input value={draft.title} onChange={(event) => edit({ title: event.target.value })} aria-label="Название" className="text-title" />
      <Textarea aria-label="Краткое содержание" value={draft.summary} rows={2} placeholder="Кратко, своими словами" onChange={(event) => edit({ summary: event.target.value })} />
      <MarkdownEditor value={draft.body} onChange={(body) => edit({ body })} onSave={() => void save()} placeholder="Редакционный текст" className="min-h-[24rem]" />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button disabled={!unsaved || update.isPending || Boolean(conflict)} onClick={() => void save()}>Сохранить</Button>
        <span role="status" className="text-label text-subtle-foreground">{update.isPending ? "Сохраняю…" : unsaved ? "Есть несохранённые изменения" : "Сохранено"}</span>
        {item.status === "archived" ? (
          <Button variant="outline" onClick={() => edit({ status: "draft" })}>Вернуть из архива</Button>
        ) : (
          <Button variant="outline" onClick={() => edit({ status: "archived" })}>В архив</Button>
        )}
        {item.status === "archived" ? (
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Удалить навсегда
          </Button>
        ) : null}
      </div>

      <Sheet open={contextOpen} onClose={() => setContextOpen(false)} title="Контекст материала" width="26rem">
        <div className="space-y-5">
          <label className="flex flex-col gap-1.5 text-label text-subtle-foreground">
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
          {isEnabled("projects") ? <label className="flex flex-col gap-1.5 text-label text-subtle-foreground">
            Проект <span className="text-micro text-subtle-foreground">Необязательно — библиотека работает и без проекта.</span>
            <Select value={draft.projectId ?? ""} onChange={(event) => edit({ projectId: event.target.value || null })}>
              <option value="">Без проекта</option>
              {(projects.data ?? []).filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </label> : null}
          <label className="flex flex-col gap-1.5 text-label text-subtle-foreground">
            Теги
            <Input value={draft.tags} placeholder="через запятую" onChange={(event) => edit({ tags: event.target.value })} />
          </label>

          <div className="space-y-2">
            <h2 className="text-label font-medium text-foreground">Источник</h2>
            {item.sources.length === 0 ? <p className="text-label text-subtle-foreground">Источников пока нет.</p> : null}
            {item.sources.map((source) => (
              <div key={source.id} className="space-y-1 rounded-lg border border-border p-3 text-label text-subtle-foreground">
                <div className="text-foreground">
                  {SOURCE_LABEL[source.type]}
                  {source.sourceTitle ? ` · ${source.sourceTitle}` : ""}
                  {source.sourceAuthor ? ` · ${source.sourceAuthor}` : ""}
                </div>
                {httpUrl(source.sourceUrl) ? <a href={httpUrl(source.sourceUrl) ?? undefined} target="_blank" rel="noreferrer" className="block break-all text-accent-text underline-offset-2 hover:underline">{source.sourceUrl}</a> : null}
                {source.originalText ? <div className="whitespace-pre-wrap">{source.originalText}</div> : null}
                {source.documentId ? <Button size="sm" variant="outline" onClick={() => openEntity("document", source.documentId!)}><BookOpen className="h-3.5 w-3.5" /> Открыть документ</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => deleteSource.mutate(source.id, { onError: () => toast({ title: "Не удалось убрать источник", tone: "danger" }) })}>
                  Убрать источник
                </Button>
              </div>
            ))}
            <details className="text-label text-subtle-foreground">
              <summary className="cursor-pointer py-1 text-foreground">Добавить источник</summary>
              <SourceForm workspaceId={workspaceId} itemId={item.id} />
            </details>
          </div>

          <Relations item={item} items={items} workspaceId={workspaceId} />
        </div>
      </Sheet>
    </div>
  );
}

function KnowledgeStatusMenu({ status, onChange }: { status: KnowledgeStatus; onChange: (status: KnowledgeStatus) => void }): React.ReactElement {
  return (
    <DropdownMenu
      align="start"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Статус: ${STATUS_LABEL[status]}. Изменить`}
          className="inline-flex items-center gap-0.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          <ChevronDown className="h-3 w-3 text-subtle-foreground" aria-hidden />
        </button>
      )}
      items={KNOWLEDGE_STATUSES.map((value) => ({
        label: STATUS_LABEL[value],
        icon: value === status ? Check : undefined,
        onSelect: () => {
          if (value !== status) onChange(value);
        }
      }))}
    />
  );
}

function KnowledgeKindMenu({ kind, onChange }: { kind: KnowledgeKind; onChange: (kind: KnowledgeKind) => void }): React.ReactElement {
  const Icon = KIND_ICON[kind];
  return (
    <DropdownMenu
      align="start"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Тип: ${KIND_LABEL[kind]}. Изменить`}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-micro text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Icon className="h-3 w-3" aria-hidden />
          {KIND_LABEL[kind]}
          <ChevronDown className="h-3 w-3 text-subtle-foreground" aria-hidden />
        </button>
      )}
      items={KNOWLEDGE_KINDS.map((value) => ({
        label: KIND_LABEL[value],
        icon: KIND_ICON[value],
        onSelect: () => {
          if (value !== kind) onChange(value);
        }
      }))}
    />
  );
}

function KnowledgeVisibilityMenu({ visibility, onChange }: { visibility: KnowledgeVisibility; onChange: (visibility: KnowledgeVisibility) => void }): React.ReactElement {
  return (
    <DropdownMenu
      align="start"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={`Видимость: ${VISIBILITY_LABEL[visibility]}. Изменить`}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-micro text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {VISIBILITY_LABEL[visibility]}
          <ChevronDown className="h-3 w-3 text-subtle-foreground" aria-hidden />
        </button>
      )}
      items={(["private", "workspace"] as const).map((value) => ({
        label: VISIBILITY_LABEL[value],
        icon: value === visibility ? Check : undefined,
        onSelect: () => {
          if (value !== visibility) onChange(value);
        }
      }))}
    />
  );
}

function SourceForm({ workspaceId, itemId }: { workspaceId: string; itemId: string }) {
  const addSource = useAddKnowledgeSource(workspaceId);
  const [type, setType] = useState<KnowledgeSourceType>("url");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [noteId, setNoteId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const notes = useNotes(type === "note" ? workspaceId : undefined);
  const documents = useDocuments(type === "document" ? workspaceId : undefined);
  const { toast } = useToast();

  return (
    <div className="mt-2 space-y-2">
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
      <Input value={author} placeholder="Автор (необязательно)" onChange={(event) => setAuthor(event.target.value)} />
      <Textarea value={text} rows={4} placeholder="Исходный текст" onChange={(event) => setText(event.target.value)} />
      <Button
        disabled={addSource.isPending}
        onClick={() => {
          void addSource
            .mutateAsync({
              itemId,
              input: { type, sourceTitle: title, sourceAuthor: author, sourceUrl: url, originalText: text, noteId: noteId || null, documentId: documentId || null }
            })
            .then(() => {
              setTitle("");
              setAuthor("");
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
  const { toast } = useToast();
  const [toId, setToId] = useState("");
  const [kind, setKind] = useState<KnowledgeRelationKind>("related");
  return (
    <div className="space-y-2">
      <h2 className="text-label font-medium text-foreground">Связи</h2>
      {item.relations.length === 0 && item.backlinks.length === 0 ? <p className="text-label text-subtle-foreground">Связей пока нет.</p> : null}
      {item.relations.map((relation) => (
        <div key={relation.id} className="flex items-center justify-between gap-2 text-label text-subtle-foreground">
          <span>
            {RELATION_LABEL[relation.kind]} · {relation.peerTitle}
          </span>
          <Button size="sm" variant="ghost" onClick={() => deleteRelation.mutate(relation.id, { onError: () => toast({ title: "Не удалось убрать связь", tone: "danger" }) })}>
            Убрать
          </Button>
        </div>
      ))}
      {item.backlinks.length > 0 ? <h3 className="text-micro uppercase tracking-wide text-subtle-foreground">На это ссылаются</h3> : null}
      {item.backlinks.map((relation) => (
        <div key={relation.id} className="text-label text-subtle-foreground">
          {relation.peerTitle} · {RELATION_LABEL[relation.kind]}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 [&>select]:min-w-0 [&>select]:flex-1">
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
          disabled={!toId || addRelation.isPending}
          onClick={() => {
            if (!toId) return;
            void addRelation.mutateAsync({ itemId: item.id, input: { toId, kind } }).then(() => setToId("")).catch(() => toast({ title: "Не удалось добавить связь", tone: "danger" }));
          }}
        >
          Связать
        </Button>
      </div>
    </div>
  );
}
