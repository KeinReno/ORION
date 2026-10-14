"use client";

import { useCaptures, useCreateCapture, useDeleteCapture, usePromoteCapture, useUpdateCapture } from "@orion/core-react";
import { CAPTURE_KIND_LABEL, captureKindSchema, type Capture, type CaptureAnchorType, type CaptureKind } from "@orion/shared-types";
import { Button, IconButton, Input, Select, useToast } from "@orion/ui";
import { Bug, Lightbulb, ListTodo, Plus, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../lib/error-message";
import { openEntity } from "../lib/extensions/host-api";

const KIND_ICON: Record<CaptureKind, React.ComponentType<{ className?: string }>> = {
  idea: Lightbulb,
  problem: Bug,
  note: StickyNote
};

const PLACEHOLDER: Record<CaptureKind, string> = {
  idea: "Что пришло в голову…",
  problem: "Что не так…",
  note: "Короткая заметка себе…"
};

/**
 * Ideas, problems and notes-to-self pinned to ONE object (`anchorType`/`anchorId`) of any module —
 * or, with both left out, to nothing. A reusable block: a host just drops it in. «Сделать задачей»
 * creates a real task and keeps the record (it then shows «В задаче»), so the original thought is
 * never lost. The tasks module being off only disables that one button on the server (409).
 */
export function CapturesSection({
  workspaceId,
  anchorType,
  anchorId
}: {
  workspaceId: string | undefined;
  anchorType?: CaptureAnchorType;
  anchorId?: string;
}): React.ReactElement {
  const { toast } = useToast();
  const anchored = Boolean(anchorType && anchorId);
  const query = anchored ? { anchorType, anchorId } : { anchorType: "none" as const };
  const { data, isLoading, isError } = useCaptures(anchored || !anchorType ? workspaceId : undefined, query);
  const create = useCreateCapture(workspaceId);
  const update = useUpdateCapture(workspaceId);
  const remove = useDeleteCapture(workspaceId);
  const promote = usePromoteCapture(workspaceId);
  const [kind, setKind] = useState<CaptureKind>("idea");
  const [title, setTitle] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const all = data ?? [];
  const visible = all.filter((c) => (showClosed ? true : c.status !== "dismissed"));
  const closedCount = all.filter((c) => c.status === "dismissed").length;

  function fail(message: string, error: unknown): void {
    toast({ title: message, description: describeError(error), tone: "danger" });
  }

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    try {
      await create.mutateAsync({ kind, title: value, body: "", anchorType: anchored ? anchorType : null, anchorId: anchored ? anchorId : null });
      setTitle("");
    } catch (error) {
      fail("Не удалось сохранить", error);
    }
  }

  function makeTask(item: Capture): void {
    promote.mutate(item.id, {
      onSuccess: () => toast({ title: "Задача создана, запись осталась", tone: "success" }),
      onError: (error) => fail("Не удалось создать задачу", error)
    });
  }

  function setStatus(item: Capture, status: "open" | "dismissed"): void {
    update.mutate({ captureId: item.id, input: { status } }, { onError: (error) => fail("Не удалось обновить", error) });
  }

  function drop(item: Capture): void {
    remove.mutate(item.id, { onError: (error) => fail("Не удалось удалить", error) });
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
        <div className="w-32 shrink-0">
          <Select aria-label="Что записать" value={kind} onChange={(event) => setKind(captureKindSchema.parse(event.target.value))}>
            {captureKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {CAPTURE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={PLACEHOLDER[kind]} aria-label="Текст записи" maxLength={200} />
        </div>
        <Button type="submit" size="sm" disabled={create.isPending || !title.trim()} aria-label="Добавить запись">
          <Plus className="h-4 w-4" />
        </Button>
      </form>

      {isLoading ? (
        <p className="text-label text-subtle-foreground">Загрузка…</p>
      ) : isError ? (
        <p className="text-label text-destructive">Не удалось загрузить записи</p>
      ) : visible.length === 0 ? (
        <p className="text-label text-subtle-foreground">Пока ничего нет. Идеи, проблемы и заметки сюда — задачей станет только то, что вы выберете.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={CAPTURE_KIND_LABEL[item.kind]} />
                <span className={item.status === "dismissed" ? "min-w-0 flex-1 truncate text-sm text-subtle-foreground line-through" : "min-w-0 flex-1 truncate text-sm"}>
                  {item.title}
                </span>
                {item.taskId ? (
                  <Button size="sm" variant="outline" onClick={() => openEntity("task", item.taskId as string)}>
                    <ListTodo className="h-4 w-4" />В задаче
                  </Button>
                ) : item.status !== "dismissed" ? (
                  <Button size="sm" variant="outline" onClick={() => makeTask(item)} disabled={promote.isPending}>
                    <ListTodo className="h-4 w-4" />
                    Сделать задачей
                  </Button>
                ) : null}
                {item.status === "dismissed" ? (
                  <IconButton label="Вернуть" size="sm" onClick={() => setStatus(item, "open")}>
                    <Undo2 className="h-4 w-4" />
                  </IconButton>
                ) : (
                  <IconButton label="Не актуально" size="sm" onClick={() => setStatus(item, "dismissed")}>
                    <X className="h-4 w-4" />
                  </IconButton>
                )}
                <IconButton label="Удалить" size="sm" onClick={() => drop(item)}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      {closedCount > 0 ? (
        <button type="button" className="self-start text-2xs text-subtle-foreground hover:text-foreground" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Скрыть закрытые" : `Показать закрытые · ${closedCount}`}
        </button>
      ) : null}
    </div>
  );
}
