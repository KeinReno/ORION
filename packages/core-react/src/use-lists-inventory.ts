"use client";

import type { AddInventoryToListInput, LinkListItemInventoryInput, ListItem } from "@orion/shared-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Plugin «Покупки → Склад» (lists-inventory). Both ends' caches change
 * together: a link or a new entry shows in the list, a purchase moves the
 * stock balance — so every mutation invalidates lists *and* inventory.
 */
function useInvalidateListsAndInventory(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["lists", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-items", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
  };
}

export function useLinkListItemInventory(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateListsAndInventory(workspaceId);
  return useMutation<ListItem, Error, { listId: string; itemId: string; input: LinkListItemInventoryInput }>({
    mutationFn: ({ listId, itemId, input }) => api.linkListItemInventory(workspaceId as string, listId, itemId, input),
    onSuccess: invalidate
  });
}

export function useAddInventoryToList(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateListsAndInventory(workspaceId);
  return useMutation<ListItem, Error, { inventoryItemId: string; input: AddInventoryToListInput }>({
    mutationFn: ({ inventoryItemId, input }) => api.addInventoryToList(workspaceId as string, inventoryItemId, input),
    onSuccess: invalidate
  });
}
