"use client";

import type {
  LanApprovePairInput,
  LanClientConnectInput,
  LanClientPairing,
  LanDevice,
  LanDiscoveredNode,
  LanEnableHostInput,
  LanHostStatus,
  LanPendingPair,
  LanPinAccount
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * ТЗ-04. Все хуки — про УЗЕЛ этой машины, не про пространство: ключи без workspaceId. Работают только пока окно
 * говорит с локальным API (режимы «Локальный»/«Хост LAN»); в режиме клиента те же запросы ушли бы на чужой хост,
 * поэтому панель «Сеть» в этом режиме обращается к локальному API напрямую (apps/web/lib/lan-local.ts).
 */
export function useLanHost(enabled = true) {
  const { api } = useCore();
  return useQuery<LanHostStatus>({ queryKey: ["lan", "host"], queryFn: () => api.getLanHost(), enabled, refetchInterval: 15_000 });
}

export function useLanPinAccounts(enabled = true) {
  const { api } = useCore();
  return useQuery<LanPinAccount[]>({ queryKey: ["lan", "pin-accounts"], queryFn: () => api.getLanPinAccounts(), enabled });
}

export function useEnableLanHost() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ restarting: boolean; status: LanHostStatus }, Error, Omit<LanEnableHostInput, "passwords"> & { passwords?: Record<string, string> }>({
    mutationFn: (input) => api.enableLanHost(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lan"] })
  });
}

export function useDisableLanHost() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ restarting: boolean; status: LanHostStatus }, Error, void>({
    mutationFn: () => api.disableLanHost(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lan"] })
  });
}

export function useRenameLanNode() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<LanHostStatus, Error, string>({
    mutationFn: (name) => api.renameLanNode(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lan"] })
  });
}

export function useOpenLanFirewall() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => api.openLanFirewall(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lan", "host"] })
  });
}

export function useLanDevices(enabled = true) {
  const { api } = useCore();
  return useQuery<LanDevice[]>({ queryKey: ["lan", "devices"], queryFn: () => api.listLanDevices(), enabled, refetchInterval: 10_000 });
}

export function useRevokeLanDevice() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.revokeLanDevice(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lan", "devices"] })
  });
}

/** Опрос раз в 2 с: заявка живёт две минуты, владелец должен увидеть её сразу. */
export function useLanPendingPairs(enabled = true) {
  const { api } = useCore();
  return useQuery<LanPendingPair[]>({ queryKey: ["lan", "pairs"], queryFn: () => api.listLanPendingPairs(), enabled, refetchInterval: 2000 });
}

export function useApproveLanPair() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; input: LanApprovePairInput }>({
    mutationFn: ({ id, input }) => api.approveLanPair(id, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["lan"] })
  });
}

export function useDenyLanPair() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.denyLanPair(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["lan", "pairs"] })
  });
}

export function useDiscoverLanNodes() {
  const { api } = useCore();
  return useMutation<LanDiscoveredNode[], Error, void>({ mutationFn: () => api.discoverLanNodes() });
}

export function useStartLanPairing() {
  const { api } = useCore();
  return useMutation<LanClientPairing, Error, LanClientConnectInput>({ mutationFn: (input) => api.startLanPairing(input) });
}

export function usePollLanPairing(pairingId: string | null) {
  const { api } = useCore();
  return useQuery<LanClientPairing>({
    queryKey: ["lan", "pairing", pairingId],
    queryFn: () => api.pollLanPairing(pairingId!),
    enabled: pairingId !== null,
    refetchInterval: (query) => (query.state.data && query.state.data.status !== "pending" ? false : 2000)
  });
}

export function useActivateLanClient() {
  const { api } = useCore();
  return useMutation<void, Error, void>({ mutationFn: () => api.activateLanClient() });
}
