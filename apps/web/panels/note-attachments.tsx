"use client";

import {
  useAttachNoteDocument,
  useDeleteNoteAttachment,
  useDocumentBlob,
  useDocuments,
  useNoteAttachments,
  useUploadNoteAttachments
} from "@orion/core-react";
import type { NoteAttachment } from "@orion/shared-types";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FilePreview,
  IconButton,
  Modal,
  Popover,
  Skeleton,
  cx,
  useToast
} from "@orion/ui";
import { AlertCircle, Download, FileUp, Link2, Paperclip, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { documentIcon, formatBytes } from "../lib/document-icons";
import { relativeTime } from "../lib/format";
import { useEnabledModules } from "../lib/use-enabled-modules";

/** Human-readable text for an unknown thrown value (ApiError carries the server's Russian message). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Повторите попытку позже";
}

/**
 * «Вложения» for one note.
 *
 * The file itself always lives in the Документы module — attaching only stores
 * a link row (`note_attachments`), so a file can be attached to a note without
 * being copied, and detaching never deletes it. Uploads go into the shared
 * "Вложения заметок" folder at the workspace root (created on demand by the
 * API), which keeps them findable in Документы instead of scattering them.
 *
 * Mounted by `NoteEditor`, next to «Связанные записи». Extracted into its own
 * file because `NotesPanel.tsx` is already at the size where a new concern
 * (drop zone + preview modal) belongs beside it, not inside it.
 */
export function NoteAttachmentsSection({
  workspaceId,
  noteId
}: {
  workspaceId: string | undefined;
  noteId: string;
}): React.ReactElement {
  const { isEnabled } = useEnabledModules();
  const documentsOn = isEnabled("documents");
  const { data: attachments, isLoading } = useNoteAttachments(documentsOn ? workspaceId : undefined, noteId);
  const { data: documents } = useDocuments(documentsOn ? workspaceId : undefined);
  const upload = useUploadNoteAttachments(workspaceId, noteId);
  const attach = useAttachNoteDocument(workspaceId, noteId);
  const detach = useDeleteNoteAttachment(workspaceId, noteId);
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<NoteAttachment | null>(null);
  const [preview, setPreview] = useState<NoteAttachment | null>(null);
  const busy = upload.isPending || attach.isPending || detach.isPending;

  // Files of this workspace that are not attached yet — the "прикрепить
  // существующий" menu never offers a duplicate (the API answers 409 for one).
  const linked = new Set((attachments ?? []).map((item) => item.documentId));
  const candidates = (documents ?? []).filter((doc) => doc.kind === "file" && !linked.has(doc.id));

  async function uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    try {
      const created = await upload.mutateAsync(files);
      toast({
        title: created.length > 1 ? `Загружено файлов: ${created.length}` : "Файл прикреплён",
        tone: "success"
      });
    } catch (error) {
      toast({ title: "Не удалось загрузить", description: errorText(error), tone: "danger" });
    }
  }

  async function attachExisting(documentId: string): Promise<void> {
    try {
      await attach.mutateAsync(documentId);
      toast({ title: "Документ прикреплён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось прикрепить", description: errorText(error), tone: "danger" });
    }
  }

  function confirmDetach(): void {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    detach.mutate(target.id, {
      onSuccess: () => toast({ title: "Вложение убрано", tone: "default" }),
      onError: (error) => toast({ title: "Не удалось убрать", description: errorText(error), tone: "danger" })
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (!documentsOn || busy) return;
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!documentsOn || busy) return;
      }}
      onDragLeave={(event) => {
        // Entering a child fires dragleave on the wrapper too — only clear the
        // highlight when the pointer actually left the section.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cx(
        "flex flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors",
        dragging ? "border-accent/60 bg-accent/[0.06]" : "border-transparent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs text-subtle-foreground">
          <Paperclip className="h-3.5 w-3.5" /> Вложения
          {attachments && attachments.length > 0 ? <span>· {attachments.length}</span> : null}
        </span>
        {documentsOn ? (
        <div className="flex items-center gap-1">
          {candidates.length > 0 ? (
            // Popover, not DropdownMenu: the note editor scrolls its own body,
            // and an absolutely positioned menu would be clipped by it.
            <Popover
              align="end"
              width={288}
              trigger={({ toggle, ref }) => (
                <button
                  ref={ref}
                  type="button"
                  disabled={busy}
                  aria-label="Прикрепить документ"
                  title="Прикрепить документ"
                  onClick={toggle}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                </button>
              )}
            >
              {({ close }) => (
                <div className="flex flex-col gap-1">
                  <p className="mb-1 text-2xs font-medium text-subtle-foreground">
                    Документы пространства
                  </p>
                  <ul className="orion-scroll max-h-64 space-y-0.5 overflow-y-auto">
                    {candidates.slice(0, 100).map((doc) => {
                      const Icon = documentIcon(doc);
                      return (
                        <li key={doc.id}>
                          <button
                            type="button"
                            disabled={attach.isPending}
                            onClick={() => {
                              close();
                              void attachExisting(doc.id);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40"
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" />
                            <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                            <span className="shrink-0 text-2xs text-subtle-foreground">
                              {formatBytes(doc.sizeBytes)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Popover>
          ) : null}
          <Button
            type="button"
            variant="subtle"
            size="sm"
            className="h-6 px-2 text-2xs"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Загрузить
          </Button>
        </div>
        ) : (
          <span className="text-2xs text-subtle-foreground">Модуль «Документы» выключен</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset first: picking the same file twice in a row must fire change again.
          event.target.value = "";
          void uploadFiles(files);
        }}
      />

      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ) : (attachments ?? []).length === 0 ? (
        <p className="flex items-center gap-1.5 px-1 py-1.5 text-2xs text-subtle-foreground">
          <FileUp className="h-3.5 w-3.5 shrink-0" />
          {dragging ? "Отпустите файлы, чтобы прикрепить" : "Перетащите файлы сюда или нажмите «Загрузить»."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {(attachments ?? []).map((item) => {
            const Icon = documentIcon({ kind: "file", name: item.name, mimeType: item.mimeType });
            return (
              <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-card-hover">
                <button
                  type="button"
                  onClick={() => setPreview(item)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">{item.name}</span>
                  <span className="shrink-0 text-2xs text-subtle-foreground">
                    {formatBytes(item.sizeBytes)}
                    {item.sizeBytes != null ? " · " : ""}
                    {relativeTime(item.createdAt)}
                  </span>
                </button>
                <IconButton
                  label="Убрать вложение"
                  size="sm"
                  className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100"
                  disabled={busy}
                  onClick={() => setPendingDelete(item)}
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Убрать вложение?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» больше не будет привязан к заметке. Файл останется в модуле «Документы».`
            : undefined
        }
        confirmLabel="Убрать"
        onConfirm={confirmDetach}
        onCancel={() => setPendingDelete(null)}
      />

      {preview ? (
        <Modal open onClose={() => setPreview(null)} title={preview.name} size="lg">
          <AttachmentPreview workspaceId={workspaceId} attachment={preview} />
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * Bytes of one attachment, rendered through the shared `<FilePreview>`. The
 * query caches hard (see `useDocumentBlob`), and the object URL is created and
 * revoked here — a plain `<img src>` can't carry the Bearer header.
 */
function AttachmentPreview({
  workspaceId,
  attachment
}: {
  workspaceId: string | undefined;
  attachment: NoteAttachment;
}): React.ReactElement {
  const { data: blob, isLoading, isError, refetch } = useDocumentBlob(workspaceId, attachment.documentId);
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

  if (isError) {
    return (
      <div className="py-6">
        <EmptyState
          icon={AlertCircle}
          tone="danger"
          title="Не удалось открыть файл"
          action={
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Повторить
            </Button>
          }
        />
      </div>
    );
  }
  if (isLoading || !url) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="h-[65vh] min-h-0">
        <FilePreview
          mime={attachment.mimeType ?? ""}
          name={attachment.name}
          url={url}
          onDownload={() => downloadFrom(url, attachment.name)}
          className="h-full"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-2xs text-subtle-foreground">
        <span>
          {formatBytes(attachment.sizeBytes)}
          {attachment.sizeBytes != null ? " · " : ""}
          прикреплён {relativeTime(attachment.createdAt)}
        </span>
        <a
          href={url}
          download={attachment.name}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-2xs text-foreground hover:bg-card-hover"
        >
          <Download className="h-3 w-3" /> Скачать
        </a>
      </div>
    </div>
  );
}

/** Trigger a browser download for an object URL (used by the "no preview" state). */
function downloadFrom(url: string, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}
