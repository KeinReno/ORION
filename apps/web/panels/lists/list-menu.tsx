"use client";

import {
  useArchiveList,
  useDeleteListPermanently,
  useDuplicateList,
  useResetList,
  useUpdateList
} from "@orion/core-react";
import { LIST_KINDS, LIST_KIND_LABELS, formatListAsText, type List, type ListKind } from "@orion/shared-types";
import { Button, ConfirmDialog, DropdownMenu, GlideSelect, IconButton, Input, Modal, useToast, type MenuItem } from "@orion/ui";
import { Archive, Copy, FileText, MoreHorizontal, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { openList } from "../../lib/panel-bus";

/**
 * The «⋯» menu of a list — the same actions on the board card and in the list's own tab, and (via
 * `items`) the card's own right-click (ORION-07): one source of the action list for both surfaces,
 * rather than a second copy that could drift from the first.
 */
export function useListMenu({
  workspaceId,
  list,
  onDeleted
}: {
  workspaceId: string | undefined;
  list: List;
  /** Called after the list stopped existing (deleted for good) — the tab of a deleted list closes itself. */
  onDeleted?: () => void;
}): { items: (MenuItem | "separator")[]; node: React.ReactElement } {
  const update = useUpdateList(workspaceId);
  const archive = useArchiveList(workspaceId);
  const remove = useDeleteListPermanently(workspaceId);
  const duplicate = useDuplicateList(workspaceId);
  const reset = useResetList(workspaceId);
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(list.name);
  const [kind, setKind] = useState<ListKind>(list.kind);

  const failed = (title: string) => (error: Error) => toast({ title, description: describeError(error), tone: "danger" });

  function openSettings(): void {
    setName(list.name);
    setKind(list.kind);
    setSettingsOpen(true);
  }

  function saveSettings(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    update.mutate(
      { listId: list.id, input: { name: trimmed, kind } },
      {
        onSuccess: () => setSettingsOpen(false),
        onError: failed("Не удалось сохранить")
      }
    );
  }

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatListAsText(list));
      toast({ title: "Список скопирован", description: "Его можно вставить в чат или заметку", tone: "success" });
    } catch {
      toast({ title: "Не удалось скопировать", tone: "danger" });
    }
  }

  const inArchive = list.archivedAt !== null;
  const items: (MenuItem | "separator")[] = [
    { label: "Настроить", icon: Pencil, onSelect: openSettings },
    {
      label: "Новый круг — снять все отметки",
      icon: RotateCcw,
      disabled: !list.items.some((item) => item.checked),
      onSelect: () =>
        reset.mutate(list.id, {
          onSuccess: () => toast({ title: "Отметки сняты", tone: "success" }),
          onError: failed("Не удалось сбросить отметки")
        })
    },
    { label: "Копировать как текст", icon: FileText, onSelect: () => void copyText() },
    "separator",
    {
      label: "Дублировать",
      icon: Copy,
      onSelect: () =>
        duplicate.mutate(
          { listId: list.id },
          {
            onSuccess: (copy) => toast({ title: "Копия создана", action: { label: "Открыть", onClick: () => openList(copy.id, copy.name) }, tone: "success" }),
            onError: failed("Не удалось дублировать")
          }
        )
    },
    {
      label: list.isTemplate ? "Сделать обычным списком" : "Сохранить как шаблон",
      icon: FileText,
      onSelect: () =>
        list.isTemplate
          ? update.mutate({ listId: list.id, input: { isTemplate: false } }, { onError: failed("Не удалось сохранить") })
          : duplicate.mutate(
              { listId: list.id, input: { asTemplate: true } },
              {
                onSuccess: () => toast({ title: "Шаблон сохранён", description: "Он на вкладке «Шаблоны»", tone: "success" }),
                onError: failed("Не удалось сохранить шаблон")
              }
            )
    },
    "separator",
    inArchive
      ? {
          label: "Вернуть из архива",
          icon: Undo2,
          onSelect: () => update.mutate({ listId: list.id, input: { archivedAt: null } }, { onError: failed("Не удалось вернуть список") })
        }
      : {
          label: "В архив",
          icon: Archive,
          onSelect: () =>
            archive.mutate(list.id, {
              onSuccess: () => toast({ title: "Список в архиве", description: "Пункты сохранены" }),
              onError: failed("Не удалось убрать в архив")
            })
        },
    ...(inArchive || list.isTemplate
      ? [{ label: "Удалить навсегда", icon: Trash2, tone: "danger" as const, onSelect: () => setConfirmDelete(true) }]
      : [])
  ];

  const node = (
    <>
      <DropdownMenu
        trigger={({ toggle }) => (
          <IconButton label="Действия со списком" size="sm" onClick={toggle}>
            <MoreHorizontal className="h-4 w-4" />
          </IconButton>
        )}
        items={items}
      />

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Настроить список"
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setSettingsOpen(false)}>
              Отмена
            </Button>
            <Button size="sm" onClick={saveSettings} disabled={!name.trim() || update.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Название</span>
            <Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveSettings()} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Вид</span>
            <GlideSelect
              label="Вид"
              options={LIST_KINDS.map((value) => LIST_KIND_LABELS[value])}
              value={LIST_KIND_LABELS[kind]}
              onChange={(label) => {
                const next = LIST_KINDS.find((value) => LIST_KIND_LABELS[value] === label);
                if (next) setKind(next);
              }}
            />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={`Удалить «${list.name}» навсегда?`}
        description="Пункты будут удалены. Приходы на склад и расходы, которые они создали, останутся."
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove.mutate(list.id, {
            onSuccess: () => {
              toast({ title: "Список удалён" });
              onDeleted?.();
            },
            onError: failed("Не удалось удалить список")
          });
        }}
      />
    </>
  );
  return { items, node };
}

/** Backward-compatible component form for call sites that only need the rendered trigger/dialogs. */
export function ListMenu(props: { workspaceId: string | undefined; list: List; onDeleted?: () => void }): React.ReactElement {
  return useListMenu(props).node;
}
