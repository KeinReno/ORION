"use client";

import { useDocumentBlob } from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { AutosaveStatus, Button, EmptyState, FilePreview, IconButton, Input, Skeleton, useDebouncedValue } from "@orion/ui";
import { AlertCircle, ChevronDown, Download, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../../lib/document-icons";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useSlotContributions } from "../../lib/extensions/slot";
import { EntityLinksSection } from "../../components/entity-links";
import { ShareGrantSection } from "../../components/share-grant-section";

export function PreviewPane({
  doc,
  onDownload,
  onRename,
  renameBusy = false,
  onEditorDirtyChange,
  onToggleList,
  listCollapsed = false
}: {
  doc: DocumentItem;
  onDownload: () => void;
  onRename?: (name: string) => void;
  renameBusy?: boolean;
  onEditorDirtyChange: (dirty: boolean) => void;
  onToggleList?: () => void;
  listCollapsed?: boolean;
}): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  // An editor plugin (office) that claims this file replaces the plain viewer; none claims it → viewer only.
  const Editor = useSlotContributions("documents.editor").find((contribution) => contribution.meta?.handles(doc))?.component;
  const { data: blob, isLoading, isError, refetch } = useDocumentBlob(workspace?.id, doc.id);
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState(doc.name);
  const debouncedName = useDebouncedValue(name.trim(), 900);
  const dirty = name.trim() !== doc.name;
  const lastSent = useRef(doc.name);

  useEffect(() => {
    setName(doc.name);
    lastSent.current = doc.name;
  }, [doc.id, doc.name]);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  useEffect(() => {
    if (!onRename || !debouncedName || debouncedName === lastSent.current) return;
    lastSent.current = debouncedName;
    onRename(debouncedName);
  }, [debouncedName, onRename]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          {onRename ? (
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2 text-micro uppercase text-subtle-foreground">
                Имя файла
                <AutosaveStatus state={renameBusy ? "saving" : dirty ? "dirty" : "saved"} />
              </span>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </label>
          ) : (
            <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
          )}
          <p className="mt-1 text-2xs text-subtle-foreground">{formatBytes(doc.sizeBytes)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onToggleList ? (
            <IconButton
              label={listCollapsed ? "Показать список файлов" : "Скрыть список файлов"}
              size="sm"
              onClick={onToggleList}
            >
              {listCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </IconButton>
          ) : null}
          <Button size="sm" variant="outline" onClick={onDownload}>
            <Download className="h-4 w-4" /> Скачать
          </Button>
        </div>
      </div>
      {Editor ? (
        <details className="group shrink-0 border-b border-border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden />
            Сведения, связи и доступ
          </summary>
          <div className="border-t border-border px-4 py-2">
            <EntityLinksSection workspaceId={workspace?.id} type="document" id={doc.id} />
          </div>
          <div className="border-t border-border px-4 py-2">
            <ShareGrantSection workspaceId={workspace?.id} type="document" id={doc.id} />
          </div>
        </details>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-4 py-2">
            <EntityLinksSection workspaceId={workspace?.id} type="document" id={doc.id} />
          </div>
          <div className="shrink-0 border-b border-border px-4 py-2">
            <ShareGrantSection workspaceId={workspace?.id} type="document" id={doc.id} />
          </div>
        </>
      )}
      <div className="min-h-0 flex-1">
        {isError ? (
          <div className="p-6">
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
          </div>
        ) : isLoading || !url ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : workspace?.id && Editor ? (
          <Editor
            key={doc.id}
            workspaceId={workspace.id}
            doc={doc}
            onDirtyChange={onEditorDirtyChange}
            fallback={<FilePreview mime={doc.mimeType ?? ""} name={doc.name} url={url} onDownload={onDownload} className="h-full" />}
          />
        ) : (
          <FilePreview mime={doc.mimeType ?? ""} name={doc.name} url={url} onDownload={onDownload} className="h-full" />
        )}
      </div>
    </div>
  );
}
