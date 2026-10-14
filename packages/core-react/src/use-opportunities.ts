"use client";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateOpportunityInput, OpportunityListQuery, UpdateOpportunityInput } from "@orion/shared-types";
import { useCore } from "./provider";

export function useOpportunities(workspaceId: string, filters: Partial<OpportunityListQuery>) {
  const { api } = useCore();
  return useInfiniteQuery({ queryKey: ["opportunities", workspaceId, filters], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listOpportunities(workspaceId, { ...filters, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined });
}
export function useOpportunityMutations(workspaceId: string) {
  const { api } = useCore();
  const cache = useQueryClient();
  const refresh = () => void cache.invalidateQueries({ queryKey: ["opportunities", workspaceId] });
  const create = useMutation({ mutationFn: (input: CreateOpportunityInput) => api.createOpportunity(workspaceId, input), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: UpdateOpportunityInput }) => api.updateOpportunity(workspaceId, id, input), onSuccess: refresh });
  return { create, update };
}
