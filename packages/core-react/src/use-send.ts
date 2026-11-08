"use client";

import type { SendAcceptInput, SendCopyInput, SendDocumentsInput, SendEnableInput, SendManualInput, SendPairInput, SendPathsInput, SendPeer, SendStatus, SendTransfer } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useSendStatus(enabled = true) {
  const { api } = useCore();
  return useQuery<SendStatus>({ queryKey: ["send", "status"], queryFn: () => api.getSendStatus(), enabled, refetchInterval: 5000 });
}

export function useSendPeers(enabled = true) {
  const { api } = useCore();
  return useQuery<SendPeer[]>({ queryKey: ["send", "peers"], queryFn: () => api.sendPeers(), enabled, refetchInterval: 5000 });
}

export function useSendRequests(enabled = true) {
  const { api } = useCore();
  return useQuery({ queryKey: ["send", "requests"], queryFn: () => api.sendPairRequests(), enabled, refetchInterval: 2000 });
}

export function useSendTransfers(enabled = true) {
  const { api } = useCore();
  return useQuery<SendTransfer[]>({
    queryKey: ["send", "transfers"],
    queryFn: () => api.sendTransfers(),
    enabled,
    refetchInterval: (query) => (query.state.data?.some((item) => ["pending", "accepted", "transferring", "verifying", "paused"].includes(item.status)) ? 1000 : 5000)
  });
}

function useSendRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["send"] });
  };
}

export function useEnableSend() {
  const { api } = useCore();
  const refresh = useSendRefresh();
  return useMutation({ mutationFn: (input: SendEnableInput) => api.enableSend(input), onSuccess: refresh });
}

export function useDiscoverSend() {
  const { api } = useCore();
  const refresh = useSendRefresh();
  return useMutation({ mutationFn: (scan: boolean) => api.discoverSend(scan), onSuccess: refresh });
}

export function useProbeSend() {
  const { api } = useCore();
  const refresh = useSendRefresh();
  return useMutation({ mutationFn: (input: SendManualInput) => api.probeSend(input), onSuccess: refresh });
}

export function useStartSendPair() {
  const { api } = useCore();
  return useMutation({ mutationFn: (input: SendPairInput) => api.startSendPair(input) });
}

export function useApproveSendPair() {
  const { api } = useCore();
  const refresh = useSendRefresh();
  return useMutation({ mutationFn: (input: { id: string; code: string }) => api.approveSendPair(input.id, input.code), onSuccess: refresh });
}

export function useSendAction() {
  const { api } = useCore();
  const refresh = useSendRefresh();
  return useMutation({
    mutationFn: async (action: { kind: "reject" | "pause" | "resume" | "cancel"; id: string } | { kind: "accept"; id: string; input?: SendAcceptInput } | { kind: "paths"; input: SendPathsInput } | { kind: "documents"; input: SendDocumentsInput } | { kind: "copy"; input: SendCopyInput } | { kind: "revoke"; id: string }) => {
      if (action.kind === "accept") return api.acceptSend(action.id, action.input);
      if (action.kind === "reject") return api.rejectSend(action.id);
      if (action.kind === "pause") return api.pauseSend(action.id);
      if (action.kind === "resume") return api.resumeSend(action.id);
      if (action.kind === "cancel") return api.cancelSend(action.id);
      if (action.kind === "paths") return api.sendPaths(action.input);
      if (action.kind === "documents") return api.sendDocumentsToDevice(action.input);
      if (action.kind === "copy") return api.sendCopy(action.input);
      return api.revokeSendPeer(action.id);
    },
    onSuccess: refresh
  });
}

export type { SendTransfer };
