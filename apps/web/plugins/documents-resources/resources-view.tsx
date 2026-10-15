"use client";

import {
  useCreateEntityLink,
  useDeleteEntityLink,
  useDocumentBlob,
  useDocuments,
  useEntityLinks,
  useUploadDocuments
} from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, IconButton, Input, Modal, Skeleton, VirtualList, FilePreview, useToast } from "@orion/ui";
import { AlertCircle, ExternalLink, FileText, Link2, Search, Unlink, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ENTITY_TYPE_LABEL, computeLinkOptions, describeError, documentIcon, formatBytes, openEntity, shortDate } from "../../lib/extensions/host-api";
import type { ResourcesSlotProps } from "../../lib/extensions/contracts";

const ROW_HEIGHT = 52;

interface ResourceRow {
  doc: DocumentItem;
  /** The link to remove when unlinking; absent in the section view (files of the workspace). */
  linkId?: string;
}

/**
 * «Ресурсы» for the context panel (ADR-0014), provided by Documents. For an object it lists the files linked
 * to it through `entity_links` — the same rows «Связанные записи» uses — and never copies bytes: one file can
 * hang on several objects, and «Открепить» removes only the link. For a section it lists the workspace's files.
 * Access is the server's: a file the actor cannot read does not come back, and its bytes are fetched with the
 * file's own authorization when it is previewed.
 */
export function ResourcesView({ workspaceId, context }: ResourcesSlotProps): React.ReactElement {
  const entity = context.kind === "entity" ? context.ref : null;
  const docsQuery = useDocuments(workspaceId, "active");
  const linksQuery = useEntityLinks(workspaceId, entity?.entityType ?? "project", entity?.entityId);
  const createLink = useCreateEntityLink(workspaceId);
  const deleteLink = useDeleteEntityLink(workspaceId);
  const upload = useUploadDocuments(workspaceId);
  const { toast } = useToast();

  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<DocumentItem | null>(null);
  const [unlinking, setUnlinking] = useState<ResourceRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A different object or section starts from a clean filter and a closed picker.
  const contextKey = entity ? `${entity.entityType}:${entity.entityId}` : context.kind === "section" ? `section:${context.panelId}` : "";
  useEffect(() => {
    setFilter("");
    setPicking(false);
    setPreview(null);
    setUnlinking(null);
  }, [contextKey]);

  const files = useMemo(() => (docsQuery.data ?? []).filter((doc) => doc.kind === "file"), [docsQuery.data]);
  const needle = filter.trim().toLowerCase();

  const linkedRows = useMemo<ResourceRow[]>(() => {
    if (!entity) return [];
    const byId = new Map(files.map((doc) => [doc.id, doc]));
    const rows: ResourceRow[] = [];
    for (const link of linksQuery.data?.items ?? []) {
      const outgoing = link.sourceType === entity.entityType && link.sourceId === entity.entityId;
      const otherType = outgoing ? link.targetType : link.sourceType;
      const otherId = outgoing ? link.targetId : link.sourceId;
      if (otherType !== "document") continue;
      const doc = byId.get(otherId);
      if (doc) rows.push({ doc, linkId: link.id });
    }
    return rows;
  }, [entity, files, linksQuery.data]);

  const linkedIds = useMemo(() => new Set(linkedRows.map((row) => row.doc.id)), [linkedRows]);
  const canLink = entity !== null && computeLinkOptions(entity.entityType, entity.entityId, "document", "probe").length > 0;

  const rows = useMemo<ResourceRow[]>(() => {
    const base = entity ? linkedRows : files.map((doc) => ({ doc }));
    return needle ? base.filter((row) => row.doc.name.toLowerCase().includes(needle)) : base;
  }, [entity, linkedRows, files, needle]);

  const candidates = useMemo(
    () => files.filter((doc) => !linkedIds.has(doc.id) && (!needle || doc.name.toLowerCase().includes(needle))),
    [files, linkedIds, needle]
  );

  const loading = docsQuery.isLoading || (entity !== null && linksQuery.isLoading);
  const failed = docsQuery.isError || (entity !== null && linksQuery.isError);

  async function link(doc: DocumentItem): Promise<void> {
    if (!entity) return;
    const options = computeLinkOptions(entity.entityType, entity.entityId, "document", doc.id);
    // A typed relation («материал для», «подтверждает расход») says more than the neutral one: prefer it.
    const option = options.find((candidate) => candidate.kind !== "related_to") ?? options[0];
    if (!option) return;
    try {
      await createLink.mutateAsync({
        sourceType: option.sourceType,
        sourceId: option.sourceId,
        targetType: option.targetType,
        targetId: option.targetId,
        kind: option.kind,
        label: null
      });
      toast({ title: "Файл связан", description: doc.name, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось связать", description: describeError(error), tone: "danger" });
    }
  }

  async function uploadAndLink(list: FileList | null): Promise<void> {
    const selected = list ? Array.from(list) : [];
    if (fileInput.current) fileInput.current.value = "";
    if (selected.length === 0 || !entity) return;
    try {
      const created = await upload.mutateAsync({ parentId: null, files: selected });
      for (const doc of created) await link(doc);
    } catch (error) {
      toast({ title: "Не удалось загрузить", description: describeError(error), tone: "danger" });
    }
  }

  async function confirmUnlink(): Promise<void> {
    const row = unlinking;
    setUnlinking(null);
    if (!row?.linkId) return;
    try {
      await deleteLink.mutateAsync(row.linkId);
      toast({ title: "Связь снята", description: `«${row.doc.name}» остаётся в «Документах».`, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось открепить", description: describeError(error), tone: "danger" });
    }
  }

  function retry(): void {
    void docsQuery.refetch();
    if (entity) void linksQuery.refetch();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={picking ? "Найти файл, чтобы связать" : "Фильтр по имени файла"}
            aria-label={picking ? "Найти файл, чтобы связать" : "Фильтр по имени файла"}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {entity && canLink ? (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={picking ? "outline" : "subtle"} className="h-7 px-2 text-2xs" onClick={() => setPicking((value) => !value)}>
              {picking ? <X className="h-3.5 w-3.5" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />} {picking ? "Готово" : "Связать"}
            </Button>
            <Button type="button" size="sm" variant="subtle" className="h-7 px-2 text-2xs" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              <Upload className="h-3.5 w-3.5" aria-hidden /> Загрузить и связать
            </Button>
            <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void uploadAndLink(event.target.files)} />
          </div>
        ) : null}
        {!entity ? (
          <p className="text-2xs text-subtle-foreground">Файлы пространства. Выберите объект в разделе, чтобы видеть связанные с ним файлы и связывать новые.</p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {failed ? (
          <div className="p-4">
            <EmptyState
              icon={AlertCircle}
              tone="danger"
              title="Не удалось загрузить файлы"
              action={
                <Button size="sm" variant="outline" onClick={retry}>
                  Повторить
                </Button>
              }
            />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Загрузка файлов">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : picking ? (
          candidates.length === 0 ? (
            <p className="p-4 text-center text-xs text-subtle-foreground">{needle ? "Ничего не найдено" : "Все файлы уже связаны."}</p>
          ) : (
            <VirtualList
              label="Файлы, которые можно связать"
              items={candidates}
              rowHeight={ROW_HEIGHT}
              getKey={(doc) => doc.id}
              className="flex-1"
              renderRow={(doc) => (
                <FileLine
                  doc={doc}
                  main={{ label: `Связать «${doc.name}»`, onClick: () => void link(doc) }}
                  disabled={createLink.isPending}
                />
              )}
            />
          )
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={FileText}
              title={needle ? "Ничего не найдено" : entity ? "Файлов пока нет" : "В пространстве нет файлов"}
              description={
                needle
                  ? "Измените фильтр."
                  : entity
                    ? canLink
                      ? `К объекту (${ENTITY_TYPE_LABEL[entity.entityType]}) ещё не привязан ни один файл.`
                      : "К этому типу объектов файлы не привязываются."
                    : "Загрузите файлы в «Документах»."
              }
            />
          </div>
        ) : (
          <VirtualList
            label="Файлы"
            items={rows}
            rowHeight={ROW_HEIGHT}
            getKey={(row) => row.doc.id}
            className="flex-1"
            renderRow={(row) => (
              <FileLine
                doc={row.doc}
                main={{ label: `Предпросмотр «${row.doc.name}»`, onClick: () => setPreview(row.doc) }}
                actions={
                  <>
                    <IconButton label={`Открыть «${row.doc.name}» в «Документах»`} size="sm" onClick={() => openEntity("document", row.doc.id, row.doc.name)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </IconButton>
                    {row.linkId ? (
                      <IconButton label={`Открепить «${row.doc.name}»`} size="sm" onClick={() => setUnlinking(row)}>
                        <Unlink className="h-3.5 w-3.5" />
                      </IconButton>
                    ) : null}
                  </>
                }
              />
            )}
          />
        )}
      </div>

      <FilePreviewModal workspaceId={workspaceId} doc={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog
        open={unlinking !== null}
        title="Открепить файл?"
        description={`«${unlinking?.doc.name ?? ""}» перестанет быть связан с этим объектом. Сам файл не удаляется и остаётся в «Документах».`}
        confirmLabel="Открепить"
        danger={false}
        onConfirm={() => void confirmUnlink()}
        onCancel={() => setUnlinking(null)}
      />
    </div>
  );
}

function FileLine({
  doc,
  main,
  actions,
  disabled
}: {
  doc: DocumentItem;
  main: { label: string; onClick: () => void };
  actions?: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  const Icon = documentIcon(doc);
  return (
    <div className="flex h-full items-center gap-1 px-2">
      <button
        type="button"
        aria-label={main.label}
        disabled={disabled}
        onClick={main.onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5"
      >
        <Icon className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-foreground" title={doc.name}>
            {doc.name}
          </span>
          <span className="block truncate text-2xs text-subtle-foreground">
            {[formatBytes(doc.sizeBytes), shortDate(doc.updatedAt)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {actions}
    </div>
  );
}

/** Quick look in a dialog: the narrow panel is no place for a PDF, and the editor in «Документах» is left alone. */
function FilePreviewModal({ workspaceId, doc, onClose }: { workspaceId: string; doc: DocumentItem | null; onClose: () => void }): React.ReactElement {
  const { data: blob, isLoading, isError, refetch } = useDocumentBlob(workspaceId, doc?.id);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  function download(): void {
    if (!url || !doc) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = doc.name;
    anchor.click();
  }

  return (
    <Modal
      open={doc !== null}
      onClose={onClose}
      title={doc?.name ?? ""}
      size="lg"
      footer={
        <>
          <Button type="button" variant="subtle" size="sm" onClick={onClose}>
            Закрыть
          </Button>
          {doc ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onClose();
                openEntity("document", doc.id, doc.name);
              }}
            >
              Открыть в «Документах»
            </Button>
          ) : null}
        </>
      }
    >
      <div className="h-[60vh] min-h-64">
        {isError ? (
          <EmptyState
            icon={AlertCircle}
            tone="danger"
            title="Не удалось загрузить файл"
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        ) : isLoading || !url || !doc ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <FilePreview mime={doc.mimeType ?? ""} name={doc.name} url={url} onDownload={download} className="h-full" />
        )}
      </div>
    </Modal>
  );
}
