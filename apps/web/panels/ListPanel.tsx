"use client";

import { useList, useReorderListItems } from "@orion/core-react";
import {
  LIST_KIND_LABELS,
  groupListItems,
  listProgress,
  sortListItems,
  type List,
  type ListItem
} from "@orion/shared-types";
import { Badge, Button, EmptyState, Input, PanelBody, PanelHeader, PanelShell, Skeleton, cx, useToast } from "@orion/ui";
import { Eraser, ListChecks, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EntityLinksSection } from "../components/entity-links";
import { describeError } from "../lib/error-message";
import { ExtensionSlot } from "../lib/extensions/slot";
import { formatMoney } from "../lib/format";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useRowDnd } from "../lib/use-row-dnd";
import { ItemAdder } from "./lists/item-adder";
import { ItemEditor } from "./lists/item-editor";
import { ReplicaBanner } from "../components/replica-banner";
import { ListItemRow } from "./lists/list-item-row";
import { ListMenu } from "./lists/list-menu";
import { useListActions } from "./lists/use-list-actions";

/**
 * One list as a dock tab (`list:<id>`, `openList` in panel-bus) or an OS window: every entry — the board
 * card only previews six —, groups, drag-and-drop order, the entry editor, totals, and the list's
 * connected records. Everyone in the workspace sees and edits the same list; the panel re-reads it every
 * few seconds, and each ticked entry says who ticked it.
 */
export function ListPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const listId = params?.instanceId;
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: list, isLoading, isError, error, refetch } = useList(workspaceId, listId);

  const listName = list?.name;
  useEffect(() => {
    if (listName && api) api.setTitle(listName);
  }, [api, listName]);

  if (!listId) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState icon={ListChecks} title="Список не выбран" description="Откройте список из раздела «Списки»." />
        </PanelBody>
      </PanelShell>
    );
  }
  if (isError) {
    return (
      <PanelShell>
        <PanelBody>
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Не удалось загрузить список"
            description={describeError(error)}
            action={
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Повторить
              </Button>
            }
          />
        </PanelBody>
      </PanelShell>
    );
  }
  if (isLoading || !list || !workspaceId) {
    return (
      <PanelShell>
        <PanelBody>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </PanelBody>
      </PanelShell>
    );
  }
  return <ListView list={list} workspaceId={workspaceId} onClose={() => api?.close?.()} />;
}

function ListView({ list, workspaceId, onClose }: { list: List; workspaceId: string; onClose: () => void }): React.ReactElement {
  const actions = useListActions(workspaceId, list);
  const reorder = useReorderListItems(workspaceId);
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtering = query.trim() !== "";
  const ordered = useMemo(() => sortListItems(list.items), [list.items]);
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const visible = needle ? ordered.filter((item) => `${item.label} ${item.note} ${item.section ?? ""}`.toLocaleLowerCase("ru").includes(needle)) : ordered;
    return groupListItems(visible);
  }, [ordered, query]);
  // Row order exactly as drawn (groups concatenated): drag-and-drop and the ↑↓ buttons move within it.
  const flat = useMemo(() => groupListItems(ordered).flatMap((group) => group.items), [ordered]);
  const sections = useMemo(() => [...new Set(list.items.map((item) => item.section).filter((s): s is string => Boolean(s)))], [list.items]);
  const progress = listProgress(list.items);
  const editing = editingId ? (list.items.find((item) => item.id === editingId) ?? null) : null;

  function applyOrder(ids: string[], moved?: { itemId: string; section: string | null }): void {
    reorder.mutate(
      { listId: list.id, input: { ids }, ...(moved ? { section: moved } : {}) },
      { onError: (error) => toast({ title: "Не удалось изменить порядок", description: describeError(error), tone: "danger" }) }
    );
  }

  function move(movedId: string, beforeId: string | null, endScope?: string): void {
    const movedItem = flat.find((item) => item.id === movedId);
    if (!movedItem) return;
    const rest = flat.filter((item) => item.id !== movedId);
    let at: number;
    let section: string | null;
    if (beforeId) {
      at = rest.findIndex((item) => item.id === beforeId);
      if (at < 0) return;
      section = rest[at]!.section ?? null;
    } else {
      section = endScope ? endScope : null;
      // End of its group: just after the group's last entry (or the end of the list for a new/empty group).
      let last = -1;
      rest.forEach((item, index) => {
        if ((item.section ?? null) === section) last = index;
      });
      at = last < 0 ? rest.length : last + 1;
    }
    const ids = [...rest.slice(0, at).map((item) => item.id), movedId, ...rest.slice(at).map((item) => item.id)];
    applyOrder(ids, (movedItem.section ?? null) !== section ? { itemId: movedId, section } : undefined);
  }

  const dnd = useRowDnd(`list:${list.id}`, move);

  function step(item: ListItem, direction: -1 | 1): void {
    const index = flat.findIndex((candidate) => candidate.id === item.id);
    const target = flat[index + direction];
    if (!target) return;
    if (direction === -1) move(item.id, target.id);
    else {
      const after = flat[index + 2];
      if (after) move(item.id, after.id);
      else move(item.id, null, target.section ?? "");
    }
  }

  const editingIndex = editing ? flat.findIndex((item) => item.id === editing.id) : -1;
  const checked = progress.checked;
  const percent = progress.total === 0 ? 0 : Math.round((checked / progress.total) * 100);

  return (
    <PanelShell>
      <PanelHeader
        icon={ListChecks}
        title={
          <span className="inline-flex items-center gap-2">
            {list.name}
            <Badge tone="neutral">{LIST_KIND_LABELS[list.kind]}</Badge>
            {list.isTemplate ? <Badge tone="accent">Шаблон</Badge> : null}
            {list.archivedAt ? <Badge tone="warning">В архиве</Badge> : null}
          </span>
        }
        subtitle={
          progress.total === 0
            ? "Пока пусто"
            : `${checked} из ${progress.total}${progress.priceMinor > 0 ? ` · ${formatMoney(progress.priceMinor)}${progress.unpriced > 0 ? ` + ещё ${progress.unpriced} без цены` : ""}` : ""}`
        }
        actions={
          <div className="flex items-center gap-1.5">
            <ExtensionSlot name="lists.actions" props={{ workspaceId, list }} />
            {checked > 0 ? (
              <Button size="sm" variant="subtle" onClick={actions.clearDone} disabled={actions.isClearing}>
                <Eraser className="h-4 w-4" /> Очистить отмеченные ({checked})
              </Button>
            ) : null}
            <ListMenu workspaceId={workspaceId} list={list} onDeleted={onClose} />
          </div>
        }
      >
        {progress.total > 0 ? (
          <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </PanelHeader>

      <ReplicaBanner workspaceId={workspaceId} />
      <PanelBody>
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <ItemAdder workspaceId={workspaceId} listId={list.id} />

          {list.items.length > 8 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти в списке" className="h-8 pl-8 text-xs" />
            </div>
          ) : null}

          {list.items.length === 0 ? (
            <EmptyState icon={ListChecks} title="Пусто" description="Добавьте первый пункт или вставьте список целиком — по пункту в строке." />
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
          ) : (
            groups.map((group) => (
              <section key={group.section ?? "__loose"} className="space-y-1">
                {group.section !== null || groups.length > 1 ? (
                  <h3 className="flex items-center gap-2 pt-1 text-xs font-medium text-subtle-foreground">
                    {group.section ?? "Без группы"}
                    <span className="font-normal">{group.items.filter((item) => item.checked).length}/{group.items.length}</span>
                  </h3>
                ) : null}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <ListItemRow
                        workspaceId={workspaceId}
                        listId={list.id}
                        item={item}
                        itemBridge={actions.itemBridge}
                        showWho
                        dnd={filtering ? undefined : dnd.bind(item.id)}
                        dragging={dnd.dragId === item.id}
                        dropBefore={dnd.overId === item.id}
                        onToggle={() => actions.toggle(item)}
                        onOpen={() => setEditingId(item.id)}
                        onDelete={() => actions.remove(item)}
                      />
                    </li>
                  ))}
                </ul>
                {!filtering ? (
                  <div
                    {...dnd.bindEnd(group.section ?? "")}
                    className={cx("h-2 rounded transition-colors", dnd.overId === `end:${group.section ?? ""}` && "bg-accent/40")}
                    aria-hidden
                  />
                ) : null}
              </section>
            ))
          )}

          {sections.length > 0 && !filtering ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
              <span>Добавить в группу:</span>
              {sections.map((name) => (
                <SectionAdder key={name} workspaceId={workspaceId} listId={list.id} section={name} />
              ))}
            </div>
          ) : null}

          <div className="border-t border-border pt-4">
            <EntityLinksSection workspaceId={workspaceId} type="list" id={list.id} />
          </div>
        </div>
      </PanelBody>

      <ItemEditor
        workspaceId={workspaceId}
        listId={list.id}
        item={editing}
        sections={sections}
        canMoveUp={editingIndex > 0}
        canMoveDown={editingIndex >= 0 && editingIndex < flat.length - 1}
        onMove={(direction) => editing && step(editing, direction)}
        onDelete={() => {
          if (editing) actions.remove(editing);
          setEditingId(null);
        }}
        onClose={() => setEditingId(null)}
      />
    </PanelShell>
  );
}

/** A chip that expands into an adder whose new entries land in that group. */
function SectionAdder({ workspaceId, listId, section }: { workspaceId: string; listId: string; section: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-0.5 hover:bg-white/5">
        {section}
      </button>
    );
  }
  return (
    <div className="w-full">
      <ItemAdder workspaceId={workspaceId} listId={listId} section={section} compact autoFocus />
    </div>
  );
}
