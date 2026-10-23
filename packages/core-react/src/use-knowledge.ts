"use client";

import type {
  CreateKnowledgeCategoryInput,
  CreateKnowledgeItemInput,
  CreateKnowledgeRelationInput,
  CreateKnowledgeSourceInput,
  KnowledgeCategory,
  KnowledgeItem,
  KnowledgeItemDetail,
  UpdateKnowledgeCategoryInput,
  UpdateKnowledgeItemInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useKnowledgeCategories(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<KnowledgeCategory[]>({
    queryKey: ["knowledge-categories", workspaceId],
    queryFn: () => api.listKnowledgeCategories(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useKnowledgeItems(workspaceId: string | undefined, includeArchived = false, query = "") {
  const { api } = useCore();
  const q = query.trim();
  return useQuery<KnowledgeItem[]>({
    queryKey: ["knowledge-items", workspaceId, includeArchived, q],
    queryFn: () => api.listKnowledgeItems(workspaceId as string, includeArchived, q || undefined),
    enabled: Boolean(workspaceId)
  });
}

export function useKnowledgeItem(workspaceId: string | undefined, itemId: string | undefined) {
  const { api } = useCore();
  return useQuery<KnowledgeItemDetail>({
    queryKey: ["knowledge-item", workspaceId, itemId],
    queryFn: () => api.getKnowledgeItem(workspaceId as string, itemId as string),
    enabled: Boolean(workspaceId && itemId)
  });
}

function useInvalidateKnowledge() {
  const client = useQueryClient();
  return (workspaceId: string) => {
    void client.invalidateQueries({ queryKey: ["knowledge-categories", workspaceId] });
    void client.invalidateQueries({ queryKey: ["knowledge-items", workspaceId] });
    void client.invalidateQueries({ queryKey: ["knowledge-item", workspaceId] });
  };
}

export function useCreateKnowledgeCategory(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (input: CreateKnowledgeCategoryInput) => api.createKnowledgeCategory(workspaceId, input),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useDeleteKnowledgeCategory(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (categoryId: string) => api.deleteKnowledgeCategory(workspaceId, categoryId),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useUpdateKnowledgeCategory(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (args: { categoryId: string; input: UpdateKnowledgeCategoryInput }) =>
      api.updateKnowledgeCategory(workspaceId, args.categoryId, args.input),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useCreateKnowledgeItem(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (input: CreateKnowledgeItemInput) => api.createKnowledgeItem(workspaceId, input),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useUpdateKnowledgeItem(workspaceId: string) {
  const { api } = useCore();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: { itemId: string; input: UpdateKnowledgeItemInput }) =>
      api.updateKnowledgeItem(workspaceId, args.itemId, args.input),
    onSuccess: (item) => {
      // The mutation already returns the complete detail. Do not fetch every open editor
      // and the unchanged category tree again on each autosave.
      client.setQueryData(["knowledge-item", workspaceId, item.id], item);
      for (const query of client.getQueryCache().findAll({ queryKey: ["knowledge-items", workspaceId] })) {
        const [, , includeArchived, search] = query.queryKey;
        if (search) {
          void client.invalidateQueries({ queryKey: query.queryKey, exact: true });
          continue;
        }
        client.setQueryData<KnowledgeItem[]>(query.queryKey, (rows) => {
          if (!rows) return rows;
          const next = rows.filter((row) => row.id !== item.id);
          if (includeArchived || item.status !== "archived") next.push(item);
          return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      }
    }
  });
}

export function useDeleteKnowledgeItem(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (itemId: string) => api.deleteKnowledgeItem(workspaceId, itemId),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useAddKnowledgeSource(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (args: { itemId: string; input: CreateKnowledgeSourceInput }) =>
      api.addKnowledgeSource(workspaceId, args.itemId, args.input),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useDeleteKnowledgeSource(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (sourceId: string) => api.deleteKnowledgeSource(workspaceId, sourceId),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useAddKnowledgeRelation(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (args: { itemId: string; input: CreateKnowledgeRelationInput }) =>
      api.addKnowledgeRelation(workspaceId, args.itemId, args.input),
    onSuccess: () => invalidate(workspaceId)
  });
}

export function useDeleteKnowledgeRelation(workspaceId: string) {
  const { api } = useCore();
  const invalidate = useInvalidateKnowledge();
  return useMutation({
    mutationFn: (relationId: string) => api.deleteKnowledgeRelation(workspaceId, relationId),
    onSuccess: () => invalidate(workspaceId)
  });
}
