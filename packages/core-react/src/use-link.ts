"use client";

import type { PairLinkDeviceInput, RotateLinkKeyInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

const key = (workspaceId: string | undefined) => ["link", workspaceId] as const;

/** ADR-0020: устройства Orion Link пользователя в пространстве. */
export function useLinkDevices(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: [...key(workspaceId), "devices"],
    queryFn: () => api.listLinkDevices(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

/** Ответ содержит ключ пакетов (`key`) — показывается один раз; в кэш react-query он не кладётся. */
export function usePairLinkDevice(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PairLinkDeviceInput) => api.pairLinkDevice(workspaceId as string, input),
    gcTime: 0,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useRevokeLinkDevice(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkDeviceId: string) => api.revokeLinkDevice(workspaceId as string, linkDeviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}

export function useRotateLinkKey(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RotateLinkKeyInput) => api.rotateLinkKey(workspaceId as string, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(workspaceId) })
  });
}
