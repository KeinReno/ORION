"use client";

import { ApiError } from "@orion/core";
import {
  useArchiveList,
  useClearCheckedItems,
  useCreateList,
  useCreateListItem,
  useDeleteListItem,
  useLists,
  useUpdateList,
  useUpdateListItem
} from "@orion/core-react";
import type { List, ListItem } from "@orion/shared-types";
import {
  Button,
  CheckToggle,
  EmptyState,
  FuseButton,
  IconButton,
  Input,
  Modal,
  PanelBody,
  PanelHeader,
  PanelShell,
  Skeleton,
  SwipeRow,
  cx,
  useToast
} from "@orion/ui";
import { Archive, ListChecks, Plus, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { describeError } from "../lib/error-message";

/**
 * Списки: lightweight checklists (shopping, to-dos) — deliberately simpler
 * than Tasks (no status/due date/recurrence) and simpler than Habits (no
 * schedule/streak). One cache — `["lists", ws, includeArchived]` — carries
 * each list with its items nested, so every mutation invalidates the same
 * single key; `useUpdateListItem` additionally patches it optimistically so
 * the checkbox answers instantly.
 */
export function ListsPanel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();

  const [showArchive, setShowArchive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameTarget, setRenameTarget] = useState<List | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const listsQuery = useLists(workspaceId, showArchive);
  const createList = useCreateList(workspaceId);
  const updateList = useUpdateList(workspaceId);
  const archiveList = useArchiveList(workspaceId);

  const lists = listsQuery.data ?? [];
  const activeLists = lists.filter((list) => !list.archivedAt);
  const archivedLists = lists.filter((list) => list.archivedAt);

  function submitCreate(): void {
    const name = newName.trim();
    if (!name) return;
    createList.mutate(
      { name },
      {
        onSuccess: () => {
          setCreating(false);
          setNewName("");
          toast({ title: "Список создан", tone: "success" });
        },
        onError: (error) =>
          toast({
            title: "Не удалось создать список",
            description: error instanceof ApiError ? error.message : undefined,
            tone: "danger"
          })
      }
    );
  }

  function submitRename(): void {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    updateList.mutate(
      { listId: renameTarget.id, input: { name } },
      {
        onSuccess: () => {
          setRenameTarget(null);
          toast({ title: "Переименовано", tone: "success" });
        },
        onError: (error) =>
          toast({
            title: "Не удалось переименовать",
            description: error instanceof ApiError ? error.message : undefined,
            tone: "danger"
          })
      }
    );
  }

  // No confirm modal: the archive button itself arms a fuse (see FuseButton
  // in ListCard) — this only runs once that window has burned out, and
  // archiving already keeps history (list can be restored), so a second
  // "are you sure" on top of the fuse would be redundant friction.
  function doArchive(list: List): void {
    archiveList.mutate(list.id, {
      onSuccess: () => toast({ title: "Список в архиве", description: "Пункты сохранены", tone: "default" }),
      onError: () => toast({ title: "Не удалось убрать в архив", tone: "danger" })
    });
  }

  async function restore(list: List): Promise<void> {
    try {
      await updateList.mutateAsync({ listId: list.id, input: { archivedAt: null } });
      toast({ title: "Список возвращён", tone: "success" });
    } catch (error) {
      toast({
        title: "Не удалось вернуть список",
        description: error instanceof ApiError ? error.message : undefined,
        tone: "danger"
      });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={ListChecks}
        title="Списки"
        subtitle="Покупки, дела — что угодно с галочками"
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaceId === undefined}>
            <Plus className="h-4 w-4" /> Новый список
          </Button>
        }
      >
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchive}
            disabled={workspaceId === undefined}
            onChange={(event) => setShowArchive(event.target.checked)}
          />
          Показать архив
        </label>
      </PanelHeader>

      <PanelBody className="[container-type:inline-size]">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-32 w-full" />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Нет рабочего пространства"
              description="Списки живут внутри пространства — создайте его или войдите заново."
            />
          )
        ) : listsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : listsQuery.isError ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить списки"
            description={describeError(listsQuery.error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void listsQuery.refetch()}>
                Повторить
              </Button>
            }
          />
        ) : activeLists.length === 0 && archivedLists.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Списков пока нет"
            description="Заведите первый — например, «Продукты»."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Новый список
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 [@container(min-width:576px)]:grid-cols-2 [@container(min-width:896px)]:grid-cols-3">
              {activeLists.map((list) => (
                <ListCard
                  key={list.id}
                  list={list}
                  workspaceId={workspaceId}
                  onRename={() => {
                    setRenameTarget(list);
                    setRenameValue(list.name);
                  }}
                  onArchive={() => doArchive(list)}
                />
              ))}
            </div>

            {showArchive ? (
              <div>
                <h3 className="mb-2 text-xs font-medium text-subtle-foreground">Архив</h3>
                {archivedLists.length === 0 ? (
                  <p className="text-xs text-muted-foreground">В архиве пусто.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {archivedLists.map((list) => (
                      <li key={list.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                        <span className="truncate text-sm text-foreground">{list.name}</span>
                        <Button size="sm" variant="subtle" disabled={updateList.isPending} onClick={() => void restore(list)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Вернуть
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        )}
      </PanelBody>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Новый список"
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setCreating(false)}>
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={submitCreate}
              disabled={!newName.trim()}
              status={createList.isPending ? "pending" : createList.isSuccess ? "success" : createList.isError ? "error" : "idle"}
            >
              Создать
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitCreate()}
          placeholder="Название списка"
        />
      </Modal>

      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Переименовать"
        footer={
          <>
            <Button variant="subtle" size="sm" onClick={() => setRenameTarget(null)}>
              Отмена
            </Button>
            <Button size="sm" onClick={submitRename} disabled={!renameValue.trim() || updateList.isPending}>
              Сохранить
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitRename()}
        />
      </Modal>
    </PanelShell>
  );
}

/** One list's card: name, checkable items, an inline "add item" field, and "clear checked" once anything is ticked. */
function ListCard({
  list,
  workspaceId,
  onRename,
  onArchive
}: {
  list: List;
  workspaceId: string | undefined;
  onRename: () => void;
  onArchive: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState("");
  const createItem = useCreateListItem(workspaceId);
  const updateItem = useUpdateListItem(workspaceId);
  const deleteItem = useDeleteListItem(workspaceId);
  const clearChecked = useClearCheckedItems(workspaceId);
  const { toast } = useToast();

  // Unchecked first (what's left to do), checked at the bottom — display-only,
  // nothing persisted (see List's model comment on why there's no sortOrder).
  const sortedItems = useMemo(
    () => [...list.items].sort((a, b) => Number(a.checked) - Number(b.checked)),
    [list.items]
  );
  const previewLimit = 6;
  const visibleItems = sortedItems.slice(0, previewLimit);
  const overflow = sortedItems.length - visibleItems.length;
  const checkedCount = list.items.filter((item) => item.checked).length;

  function addItem(): void {
    const label = draft.trim();
    if (!label) return;
    createItem.mutate({ listId: list.id, input: { label } }, { onSuccess: () => setDraft("") });
  }

  function toggle(item: ListItem): void {
    updateItem.mutate({ listId: list.id, itemId: item.id, input: { checked: !item.checked } });
  }

  function clearDone(): void {
    const snapshot = list.items.filter((item) => item.checked);
    if (snapshot.length === 0) return;
    clearChecked.mutate(list.id, {
      onSuccess: () =>
        toast({
          title: "Отмеченные очищены",
          action: {
            label: "Отменить",
            onClick: () => {
              void (async () => {
                for (const item of snapshot) {
                  const created = await createItem.mutateAsync({ listId: list.id, input: { label: item.label } });
                  if (item.checked) {
                    await updateItem.mutateAsync({ listId: list.id, itemId: created.id, input: { checked: true } });
                  }
                }
              })();
            }
          }
        }),
      onError: () => toast({ title: "Не удалось очистить отмеченные", tone: "danger" })
    });
  }

  const hasChecked = checkedCount > 0;

  return (
    <div className="flex flex-col rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onRename} className="min-w-0 truncate text-left text-title text-foreground hover:underline">
          {list.name}
        </button>
        <FuseButton label="В архив" armedLabel="Ещё раз — архив" doneLabel="В архиве" icon={Archive} onCommit={onArchive} />
      </div>
      {list.items.length > 0 ? (
        <p className="mt-1 text-micro text-subtle-foreground">
          {checkedCount} из {list.items.length}
        </p>
      ) : null}

      {sortedItems.length === 0 ? (
        <div className="mt-2">
          <EmptyState icon={ListChecks} title="Пусто" description="Добавьте первый пункт." />
        </div>
      ) : (
        <ul className="mt-2 space-y-1">
          {visibleItems.map((item) => (
            <li key={item.id}>
              <SwipeRow
                actions={[
                  {
                    label: "Удалить",
                    icon: X,
                    tone: "danger",
                    onSelect: () => deleteItem.mutate({ listId: list.id, itemId: item.id })
                  }
                ]}
              >
                <div className="group flex items-center gap-2 px-0.5 py-0.5">
                  <CheckToggle checked={item.checked} onClick={() => toggle(item)} label={item.label} size="sm" />
                  <span className={cx("min-w-0 flex-1 truncate text-body text-foreground", item.checked && "text-muted-foreground line-through")}>
                    {item.label}
                  </span>
                  <IconButton
                    label="Удалить пункт"
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:hidden"
                    onClick={() => deleteItem.mutate({ listId: list.id, itemId: item.id })}
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </SwipeRow>
            </li>
          ))}
        </ul>
      )}

      {overflow > 0 ? (
        <p className="mt-1 text-micro text-subtle-foreground">ещё {overflow}</p>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Добавить пункт"
          className="h-8 text-xs"
        />
        <IconButton label="Добавить пункт" size="sm" onClick={addItem} disabled={!draft.trim()}>
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      {hasChecked ? (
        <button
          type="button"
          onClick={clearDone}
          className="mt-2 self-start text-micro text-subtle-foreground hover:text-foreground"
        >
          {`Очистить отмеченные (${checkedCount}) — можно отменить`}
        </button>
      ) : null}
    </div>
  );
}
