"use client";

import { useCore, useDocumentVersions, useRestoreDocumentVersion } from "@orion/core-react";
import type { DocumentItem, DocumentVersion } from "@orion/shared-types";
import { Button, ConfirmDialog, EmptyState, Skeleton, cx, useToast } from "@orion/ui";
import { motion, useReducedMotion } from "framer-motion";
import { Download, History } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../../lib/extensions/host-api";
import { relativeTime } from "../../lib/extensions/host-api";

/**
 * Version history for one file, rendered inside a Sheet from DocumentsPanel.
 * Mirrors NoteHistory's list + restore flow, but without a diff view — a
 * file's content is often binary (PDF/Excel), so there's nothing to diff;
 * download + restore is the useful pair here.
 */
export function DocumentHistory({
  workspaceId,
  doc,
  onRestored
}: {
  workspaceId: string | undefined;
  doc: DocumentItem;
  onRestored: () => void;
}): React.ReactElement {
  const { api } = useCore();
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const { data: versions, isLoading } = useDocumentVersions(workspaceId, doc.id);
  const restore = useRestoreDocumentVersion(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function downloadVersion(version: DocumentVersion): Promise<void> {
    if (!workspaceId) return;
    try {
      const blob = await api.getDocumentVersionBlob(workspaceId, doc.id, version.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.name} (версия ${version.versionNumber})`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Не удалось скачать", description: (e as Error).message, tone: "danger" });
    }
  }

  function doRestore(): void {
    if (!selectedId) return;
    setConfirming(false);
    restore.mutate(
      { id: doc.id, versionId: selectedId },
      {
        onSuccess: () => {
          toast({ title: "Версия восстановлена", tone: "success" });
          onRestored();
        },
        onError: (e) => toast({ title: "Не удалось восстановить", description: (e as Error).message, tone: "danger" })
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          icon={History}
          title="Версий пока нет"
          description="Снимок сохраняется перед каждой заменой содержимого."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="orion-scroll relative flex-1 space-y-1 overflow-y-auto p-5 pl-8">
        <div className="absolute bottom-7 left-[26px] top-7 w-px bg-border" aria-hidden />
        {versions.map((v, i) => (
          <motion.div
            key={v.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15, delay: reduceMotion ? 0 : i * 0.03 }}
            className="relative"
          >
            <span
              className={cx(
                "absolute -left-[15px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2",
                v.id === selectedId ? "border-accent bg-accent" : "border-border-strong bg-background"
              )}
              aria-hidden
            />
            <div
              className={cx(
                "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
                v.id === selectedId
                  ? "border-accent/40 bg-accent/[0.07] text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-card-hover"
              )}
            >
              <button type="button" onClick={() => setSelectedId(v.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium text-foreground">Версия {v.versionNumber}</span>
                <span className="block text-2xs text-subtle-foreground">
                  {formatBytes(v.sizeBytes)} · {relativeTime(v.createdAt)}
                </span>
              </button>
              <Button size="sm" variant="subtle" onClick={() => void downloadVersion(v)}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          type="button"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={!selectedId}
          status={restore.isPending ? "pending" : restore.isSuccess ? "success" : restore.isError ? "error" : "idle"}
        >
          Восстановить эту версию
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Восстановить версию?"
        description="Текущее содержимое сохранится в историю — откат можно отменить."
        onConfirm={doRestore}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
