"use client";

import { useNoteRevision, useNoteRevisions, useRestoreNoteRevision } from "@orion/core-react";
import { Button, ConfirmDialog, DiffView, EmptyState, Skeleton, cx, useToast } from "@orion/ui";
import { motion, useReducedMotion } from "framer-motion";
import { History } from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "../../lib/extensions/host-api";

/**
 * Version history for one note, rendered inside a Sheet from NoteEditor.
 * Picks a past snapshot, diffs it against the note's current content, and
 * can roll back to it. Split out of NotesPanel — an independent concern,
 * same rationale as `task-form.tsx` (see CLAUDE.md "Про размер файлов").
 */
export function NoteHistory({
  workspaceId,
  noteId,
  currentTitle,
  currentBody,
  onRestored
}: {
  workspaceId: string | undefined;
  noteId: string;
  currentTitle: string;
  currentBody: string;
  onRestored: () => void;
}): React.ReactElement {
  const reduceMotion = useReducedMotion();
  const { data: revisions, isLoading } = useNoteRevisions(workspaceId, noteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: revision } = useNoteRevision(workspaceId, noteId, selectedId ?? undefined);
  const restore = useRestoreNoteRevision(workspaceId, noteId);
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  // Default to the newest snapshot once the list arrives.
  useEffect(() => {
    if (!selectedId && revisions && revisions.length > 0) setSelectedId(revisions[0].id);
  }, [revisions, selectedId]);

  function doRestore(): void {
    if (!selectedId) return;
    setConfirming(false);
    restore.mutate(selectedId, {
      onSuccess: () => {
        toast({ title: "Версия восстановлена", tone: "success" });
        onRestored();
      }
    });
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

  if (!revisions || revisions.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          icon={History}
          title="Версий пока нет"
          description="Снимок сохраняется перед каждой правкой тела или заголовка."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="orion-scroll flex-1 space-y-3 overflow-y-auto p-5">
        <div className="relative">
          <div className="absolute bottom-4 left-[15px] top-4 w-px bg-border" aria-hidden />
          <ul className="orion-scroll max-h-40 space-y-1 overflow-y-auto pl-6">
          {revisions.map((rev, i) => (
            <motion.li
              key={rev.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15, delay: reduceMotion ? 0 : i * 0.03 }}
              className="relative"
            >
              <span
                className={cx(
                  "absolute -left-[13px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2",
                  rev.id === selectedId ? "border-accent bg-accent" : "border-border-strong bg-background"
                )}
                aria-hidden
              />
              <button
                type="button"
                onClick={() => setSelectedId(rev.id)}
                className={cx(
                  "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
                  rev.id === selectedId
                    ? "border-accent/40 bg-accent/[0.07] text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-card-hover"
                )}
              >
                <span className="truncate">{rev.title || "Без заголовка"}</span>
                <span className="shrink-0 text-2xs text-subtle-foreground">{relativeTime(rev.createdAt)}</span>
              </button>
            </motion.li>
          ))}
          </ul>
        </div>

        {revision ? (
          <>
            {revision.title !== currentTitle ? (
              <p className="text-2xs text-subtle-foreground">
                Заголовок: <span className="text-destructive line-through">{revision.title || "—"}</span> →{" "}
                <span className="text-success">{currentTitle || "—"}</span>
              </p>
            ) : null}
            <p className="text-2xs text-subtle-foreground">
              Отличия выбранной версии от текущей ({relativeTime(revision.createdAt)}):
            </p>
            <DiffView before={revision.body} after={currentBody} className="max-h-[45vh]" />
          </>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
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
