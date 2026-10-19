"use client";

import { useReplicaEntityState } from "@orion/core-react";
import { formatListQuantity, type ListItem } from "@orion/shared-types";
import { CheckToggle, cx, IconButton, StrikeText, SwipeRow } from "@orion/ui";
import { CalendarClock, GripVertical, StickyNote, X } from "lucide-react";
import type { DragEvent } from "react";
import { SyncStateMark } from "../../components/replica-banner";
import { ExtensionSlot } from "../../lib/extensions/slot";
import type { ListsItemApi } from "../../lib/extensions/contracts";
import { formatMoney, shortDate } from "../../lib/format";

export interface RowDndProps {
  draggable: true;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}

/** True when the entry has a «by when» in the past and is still open. */
export function isItemOverdue(item: Pick<ListItem, "checked" | "dueAt">, now = Date.now()): boolean {
  return !item.checked && item.dueAt !== null && new Date(item.dueAt).getTime() < now;
}

/**
 * One entry of a list. `compact` is the board card's preview (no grip, no price, the label is not a
 * button); the full row opens the entry editor on click of its text and can be dragged by its grip.
 */
export function ListItemRow({
  workspaceId,
  listId,
  item,
  itemBridge,
  compact = false,
  showWho = false,
  dnd,
  dropBefore = false,
  dragging = false,
  onToggle,
  onOpen,
  onDelete
}: {
  workspaceId: string;
  listId: string;
  item: ListItem;
  itemBridge?: ListsItemApi;
  compact?: boolean;
  /** Show who ticked the entry (family lists). */
  showWho?: boolean;
  dnd?: RowDndProps;
  /** A drop indicator above this row. */
  dropBefore?: boolean;
  dragging?: boolean;
  onToggle: () => void;
  onOpen?: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const amount = formatListQuantity(item);
  const overdue = isItemOverdue(item);
  const syncState = useReplicaEntityState(workspaceId, "listItem", item.id);
  const labelClass = cx("min-w-0 flex-1 truncate text-left text-body text-foreground", item.checked && "text-muted-foreground");

  return (
    <SwipeRow actions={[{ label: "Удалить", icon: X, tone: "danger", onSelect: onDelete }]}>
      <div
        {...(dnd ?? {})}
        className={cx(
          "group relative flex items-center gap-2 rounded-md px-0.5 py-0.5",
          dragging && "opacity-40",
          dropBefore && "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded before:bg-accent"
        )}
      >
        {dnd && !compact ? (
          <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 max-sm:hidden" aria-hidden />
        ) : null}
        <CheckToggle checked={item.checked} onClick={onToggle} label={item.label} size="sm" />
        {onOpen && !compact ? (
          <button type="button" onClick={onOpen} className={labelClass} title="Изменить пункт">
            <StrikeText done={item.checked}>{item.label}</StrikeText>
          </button>
        ) : (
          <span className={labelClass}><StrikeText done={item.checked}>{item.label}</StrikeText></span>
        )}

        {amount && !(itemBridge && item.inventoryItemId) ? <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-micro text-muted-foreground">{amount}</span> : null}
        {item.dueAt ? (
          <span
            className={cx("inline-flex shrink-0 items-center gap-1 text-micro", overdue ? "text-destructive" : "text-subtle-foreground")}
            title={overdue ? "Срок прошёл" : "Срок"}
          >
            <CalendarClock className="h-3 w-3" aria-hidden />
            {shortDate(item.dueAt)}
          </span>
        ) : null}
        <SyncStateMark state={syncState} />
        {item.note ? <StickyNote className="h-3 w-3 shrink-0 text-subtle-foreground" aria-label="Есть заметка" /> : null}
        {!compact && item.priceMinor !== null ? (
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">{formatMoney(item.priceMinor)}</span>
        ) : null}
        {showWho && item.checked && item.checkedByName ? (
          <span className="shrink-0 text-micro text-subtle-foreground" title="Кто отметил">
            {item.checkedByName}
          </span>
        ) : null}

        {itemBridge ? <itemBridge.ItemExtra workspaceId={workspaceId} listId={listId} item={item} /> : null}
        <ExtensionSlot name="lists.item.mark" props={{ workspaceId, listId, item }} />
        <IconButton
          label="Удалить пункт"
          size="sm"
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:hidden"
          onClick={onDelete}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </SwipeRow>
  );
}
