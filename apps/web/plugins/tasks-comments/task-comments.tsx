"use client";

import { useState } from "react";
import {
  useCreateTaskComment,
  useDeleteTaskComment,
  useSession,
  useTaskComments,
  useUpdateTaskComment
} from "@orion/core-react";
import { Button, IconButton, MarkdownView, Skeleton, Textarea, useToast } from "@orion/ui";
import { Pencil, Trash2 } from "lucide-react";
import { relativeTime } from "../../lib/format";
import { describeError } from "../../lib/error-message";
import { useUnsavedDraft } from "../../lib/unsaved-drafts";

/**
 * S17 «Комментарии задачи». Plain REST CRUD + react-query refetch — no
 * websockets/typing/presence (explicitly out of scope, see 10-BACKLOG.md
 * S17). Bodies render through the shared `MarkdownView` (markdown-it,
 * `html: false`) — the same safe path note bodies use, so there is no
 * separate sanitizer to get wrong here.
 */
export function TaskCommentsSection({
  workspaceId,
  taskId
}: {
  workspaceId: string | undefined;
  taskId: string | undefined;
}): React.ReactElement {
  const { user } = useSession();
  const { data, isLoading } = useTaskComments(workspaceId, taskId);
  const create = useCreateTaskComment(workspaceId, taskId);
  const update = useUpdateTaskComment(workspaceId, taskId);
  const remove = useDeleteTaskComment(workspaceId, taskId);
  const { toast } = useToast();

  const [draft, setDraft] = useState("");
  useUnsavedDraft(draft.trim() !== "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const items = data?.items ?? [];
  // API returns newest-first (cursor pagination); a comment thread reads
  // oldest-first, so the currently loaded page is reversed for display.
  const ordered = [...items].reverse();

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await create.mutateAsync({ body });
      setDraft("");
    } catch (error) {
      toast({ title: describeError(error), tone: "danger" });
    }
  };

  const saveEdit = async (commentId: string) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await update.mutateAsync({ commentId, input: { body } });
      setEditingId(null);
    } catch (error) {
      toast({ title: describeError(error), tone: "danger" });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-caption font-medium text-muted-foreground">Комментарии</h3>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : ordered.length === 0 ? (
        <p className="text-micro text-muted-foreground">Пока нет комментариев.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((comment) => (
            <li key={comment.id} className="rounded-lg border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-micro font-medium text-foreground">{comment.authorName}</span>
                <span className="text-micro text-muted-foreground">
                  {relativeTime(comment.createdAt)}
                  {comment.editedAt ? " · изменено" : ""}
                </span>
              </div>
              {editingId === comment.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} autoFocus />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(comment.id)} disabled={update.isPending}>
                      Сохранить
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex items-start justify-between gap-2">
                  <MarkdownView source={comment.body} className="text-body-sm" />
                  {comment.mine ? (
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label="Редактировать"
                        size="sm"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditDraft(comment.body);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Удалить" size="sm" tone="danger" onClick={() => remove.mutate(comment.id)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.nextCursor ? <p className="text-micro text-muted-foreground">Показаны последние {items.length} — более старые скрыты.</p> : null}
      {user ? (
        <div className="flex flex-col gap-2">
          <Textarea
            placeholder="Написать комментарий…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
          />
          <div>
            <Button size="sm" onClick={submit} disabled={create.isPending || !draft.trim()}>
              Отправить
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
