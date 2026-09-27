"use client";

import { useDeleteNoteTag, useRenameNoteTag } from "@orion/core-react";
import { Button, ConfirmDialog, IconButton, Input, Modal, cx, useToast } from "@orion/ui";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";

/**
 * Workspace-wide tag housekeeping: rename (a rename when the target is new,
 * a merge when it already exists) and delete across every note. Split out of
 * NotesPanel — its own concern, opened from the tag-filter row.
 */
export function TagManager({
  workspaceId,
  tags,
  open,
  onClose
}: {
  workspaceId: string | undefined;
  tags: string[];
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const rename = useRenameNoteTag(workspaceId);
  const remove = useDeleteNoteTag(workspaceId);
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const busy = rename.isPending || remove.isPending;

  function startEdit(tag: string): void {
    setEditing(tag);
    setDraft(tag);
  }

  function commitRename(): void {
    const from = editing;
    const to = draft.trim();
    if (!from || !to || to === from) {
      setEditing(null);
      return;
    }
    const merging = tags.some((t) => t.toLowerCase() === to.toLowerCase() && t !== from);
    rename.mutate(
      { from, to },
      {
        onSuccess: (res) => {
          toast({
            title: merging ? `Объединено с «${to}» (${res.updated})` : `Переименовано в «${to}» (${res.updated})`,
            tone: "success"
          });
          setEditing(null);
        }
      }
    );
  }

  function confirmDelete(): void {
    const tag = pendingDelete;
    if (!tag) return;
    setPendingDelete(null);
    remove.mutate(tag, {
      onSuccess: (res) => toast({ title: `Тег «${tag}» удалён (${res.updated})`, tone: "default" })
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Управление тегами" size="sm">
      {tags.length === 0 ? (
        <p className="py-4 text-center text-sm text-subtle-foreground">Тегов пока нет.</p>
      ) : (
        <ul className="orion-scroll max-h-[50vh] space-y-1 overflow-y-auto">
          {tags.map((tag) => {
            const isEditing = editing === tag;
            return (
              <li
                key={tag}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                  isEditing ? "border-accent/40" : "border-border"
                )}
              >
                {isEditing ? (
                  <>
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          setEditing(null);
                        }
                      }}
                      className="h-7 py-0 text-xs"
                    />
                    <IconButton label="Сохранить" size="sm" onClick={commitRename} disabled={busy}>
                      <Check className="h-4 w-4" />
                    </IconButton>
                    <IconButton label="Отмена" size="sm" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-xs font-medium text-foreground">{tag}</span>
                    <IconButton label="Переименовать" size="sm" onClick={() => startEdit(tag)} disabled={busy}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton
                      label="Удалить тег"
                      size="sm"
                      tone="danger"
                      onClick={() => setPendingDelete(tag)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="subtle" size="sm" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить тег?"
        description={pendingDelete ? `«${pendingDelete}» пропадёт со всех заметок. Сами заметки останутся.` : undefined}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Modal>
  );
}
