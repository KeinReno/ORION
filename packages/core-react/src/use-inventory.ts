"use client";

import type {
  CreateInventoryItemInput,
  CreateInventoryMovementInput,
  InventoryItem,
  InventoryMovement,
  UpdateInventoryItemInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useInventoryItems(workspaceId: string | undefined, includeArchived = false) {
  const { api } = useCore();
  return useQuery<InventoryItem[]>({
    queryKey: ["inventory-items", workspaceId, includeArchived],
    queryFn: () => api.listInventoryItems(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId)
  });
}

/** Ledger for one item — only fetched once its detail view is open. */
export function useInventoryMovements(workspaceId: string | undefined, itemId: string | undefined) {
  const { api } = useCore();
  return useQuery<InventoryMovement[]>({
    queryKey: ["inventory-movements", workspaceId, itemId],
    queryFn: () => api.listInventoryMovements(workspaceId as string, itemId as string),
    enabled: Boolean(workspaceId) && Boolean(itemId)
  });
}

function useInvalidateInventory(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["inventory-items", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["inventory-movements", workspaceId] });
  };
}

export function useCreateInventoryItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateInventory(workspaceId);
  return useMutation<InventoryItem, Error, CreateInventoryItemInput>({
    mutationFn: (input: CreateInventoryItemInput) => api.createInventoryItem(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useUpdateInventoryItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateInventory(workspaceId);
  return useMutation<InventoryItem, Error, { itemId: string; input: UpdateInventoryItemInput }>({
    mutationFn: ({ itemId, input }: { itemId: string; input: UpdateInventoryItemInput }) =>
      api.updateInventoryItem(workspaceId as string, itemId, input),
    onSuccess: invalidate
  });
}

/** `DELETE` archives the item; its ledger stays and `useUpdateInventoryItem` with `{ archivedAt: null }` brings it back. */
export function useArchiveInventoryItem(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateInventory(workspaceId);
  return useMutation<InventoryItem, Error, string>({
    mutationFn: (itemId: string) => api.archiveInventoryItem(workspaceId as string, itemId),
    onSuccess: invalidate
  });
}

export function useRecordInventoryMovement(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateInventory(workspaceId);
  return useMutation<InventoryMovement, Error, { itemId: string; input: CreateInventoryMovementInput }>({
    mutationFn: ({ itemId, input }: { itemId: string; input: CreateInventoryMovementInput }) =>
      api.recordInventoryMovement(workspaceId as string, itemId, input),
    onSuccess: invalidate
  });
}
