"use client";

import type { AgentAuditEntry, AgentToken, CreateAgentTokenInput, CreatedAgentToken } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useAgentTokens(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<AgentToken[]>({
    queryKey: ["agent-tokens", workspaceId],
    queryFn: () => api.listAgentTokens(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useAgentAuditLog(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<AgentAuditEntry[]>({
    queryKey: ["agent-tokens", workspaceId, "audit"],
    queryFn: () => api.listAgentAudit(workspaceId as string),
    enabled: Boolean(workspaceId),
    refetchInterval: 30_000
  });
}

export function useCreateAgentToken(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<CreatedAgentToken, Error, CreateAgentTokenInput>({
    mutationFn: (input) => api.createAgentToken(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-tokens", workspaceId] })
  });
}

export function useRevokeAgentToken(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => api.revokeAgentToken(workspaceId as string, tokenId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-tokens", workspaceId] })
  });
}
