"use client";

import type { AgentConnectionInfo, AgentAuditEntry, AgentAuditQuery, AgentProposal, AgentProposalBulkResult, UpdateAgentTokenInput, AgentToken, CreateAgentTokenInput, CreatedAgentToken } from "@orion/shared-types";
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

export function useAgentConnection(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<AgentConnectionInfo>({
    queryKey: ["agent-connection", workspaceId],
    queryFn: () => api.getAgentConnection(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60_000
  });
}

export function useAgentAuditLog(workspaceId: string | undefined, query: AgentAuditQuery = {}) {
  const { api } = useCore();
  return useQuery<AgentAuditEntry[]>({
    queryKey: ["agent-tokens", workspaceId, "audit", query],
    queryFn: () => api.listAgentAudit(workspaceId as string, query),
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

/** Destructive actions agents asked for; a human approves or rejects each one. */
export function useAgentProposals(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<AgentProposal[]>({
    queryKey: ["agent-tokens", workspaceId, "proposals"],
    queryFn: () => api.listAgentProposals(workspaceId as string),
    enabled: Boolean(workspaceId),
    refetchInterval: 15_000
  });
}

export function useDecideAgentProposal(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { proposalId: string; decision: "approve" | "reject" }) => api.decideAgentProposal(workspaceId as string, v.proposalId, v.decision),
    // An approved deletion changes tasks/notes too: the cross-window sync and these keys refresh them.
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useUpdateAgentToken(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<AgentToken, Error, { tokenId: string; input: UpdateAgentTokenInput }>({
    mutationFn: (v) => api.updateAgentToken(workspaceId as string, v.tokenId, v.input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-tokens", workspaceId] })
  });
}

/** The panic button: every live token of the caller. */
export function useRevokeAllAgentTokens(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<number, Error, void>({
    mutationFn: () => api.revokeAllAgentTokens(workspaceId as string),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-tokens", workspaceId] })
  });
}

/** "Отменить создание": the note goes to the trash, the task is canceled. */
export function useUndoAgentCreation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<AgentAuditEntry, Error, string>({
    mutationFn: (entryId) => api.undoAgentCreation(workspaceId as string, entryId),
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useDecideAgentProposalsBulk(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<AgentProposalBulkResult, Error, { ids: string[]; decision: "approve" | "reject" }>({
    mutationFn: (v) => api.decideAgentProposalsBulk(workspaceId as string, v),
    onSuccess: () => queryClient.invalidateQueries()
  });
}
