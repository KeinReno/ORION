"use client";

import {
  useClearCheckedItems,
  useCore,
  useCreateListItem,
  useDeleteListItem,
  useRestoreListItems,
  useUpdateListItem
} from "@orion/core-react";
import type { List, ListItem } from "@orion/shared-types";
import { useToast } from "@orion/ui";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "../../lib/error-message";
import { useSlotContributions } from "../../lib/extensions/slot";
import { useEnabledModules } from "../../lib/use-enabled-modules";

/**
 * What both views of a list (the card on the board and the list's own tab) do with its entries: tick one
 * (a bridge plugin may take the tick over), add, delete, and «Очистить отмеченные» with a real undo.
 */
export function useListActions(workspaceId: string | undefined, list: List) {
  const createItem = useCreateListItem(workspaceId);
  const updateItem = useUpdateListItem(workspaceId);
  const deleteItem = useDeleteListItem(workspaceId);
  const clearChecked = useClearCheckedItems(workspaceId);
  const restoreItems = useRestoreListItems(workspaceId);
  const { toast } = useToast();
  // A bridge plugin (lists.item, e.g. «Покупки → Склад») may mark entries and take over ticking them.
  const itemBridge = useSlotContributions("lists.item")[0]?.meta?.api;
  const { api } = useCore();
  const queryClient = useQueryClient();
  const { isEnabled } = useEnabledModules();

  function toggle(item: ListItem): void {
    if (!item.checked && itemBridge && workspaceId) {
      const completion = itemBridge.completeItem({ api, queryClient, workspaceId, listId: list.id, item, isModuleEnabled: isEnabled });
      if (completion) {
        completion.catch((error: unknown) => toast({ title: "Не удалось отметить пункт", description: describeError(error), tone: "danger" }));
        return;
      }
    }
    updateItem.mutate({ listId: list.id, itemId: item.id, input: { checked: !item.checked } });
  }

  function remove(item: ListItem): void {
    deleteItem.mutate(
      { listId: list.id, itemId: item.id },
      { onError: (error) => toast({ title: "Не удалось удалить пункт", description: describeError(error), tone: "danger" }) }
    );
  }

  /** The server hands back what it removed — whole, with stock/finance links — and «Отменить» puts exactly that back. */
  function clearDone(): void {
    if (!list.items.some((item) => item.checked)) return;
    clearChecked.mutate(list.id, {
      onSuccess: ({ removed }) =>
        toast({
          title: `Очищено: ${removed.length}`,
          action: {
            label: "Отменить",
            onClick: () =>
              restoreItems.mutate(
                { listId: list.id, input: { items: removed } },
                { onError: (error) => toast({ title: "Не удалось вернуть пункты", description: describeError(error), tone: "danger" }) }
              )
          }
        }),
      onError: () => toast({ title: "Не удалось очистить отмеченные", tone: "danger" })
    });
  }

  return { createItem, updateItem, deleteItem, itemBridge, toggle, remove, clearDone, isClearing: clearChecked.isPending };
}
