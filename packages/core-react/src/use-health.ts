"use client";

import type {
  CreateHealthAppointmentInput,
  CreateHealthPreventiveInput,
  CreateHealthSubjectInput,
  HealthAppointment,
  HealthGrant,
  HealthPreventiveItem,
  HealthSubject,
  HealthToday,
  MarkHealthPreventiveDoneInput,
  PutHealthGrantInput,
  UpdateHealthAppointmentInput,
  UpdateHealthPreventiveInput,
  UpdateHealthSubjectInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Module «Здоровье» (ADR-0012). Everything lives under `["health", ws, …]`; a write refreshes that whole tree
 * (small, per person). Nothing here is shared with search, links or other modules on purpose.
 */
const root = (workspaceId: string | undefined) => ["health", workspaceId] as const;

function useRefresh(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: root(workspaceId) });
}

/** What needs attention across every person the viewer may see. `today` is the viewer's own day (YYYY-MM-DD). */
export function useHealthToday(workspaceId: string | undefined, today: string) {
  const { api } = useCore();
  return useQuery<HealthToday>({
    queryKey: [...root(workspaceId), "today", today],
    queryFn: () => api.healthToday(workspaceId as string, today),
    enabled: Boolean(workspaceId)
  });
}

export function useHealthSubjects(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<HealthSubject[]>({
    queryKey: [...root(workspaceId), "subjects"],
    queryFn: () => api.listHealthSubjects(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useCreateHealthSubject(workspaceId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthSubjectInput) => api.createHealthSubject(workspaceId as string, input), onSuccess: refresh });
}

export function useUpdateHealthSubject(workspaceId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ subjectId, input }: { subjectId: string; input: UpdateHealthSubjectInput }) => api.updateHealthSubject(workspaceId as string, subjectId, input),
    onSuccess: refresh
  });
}

export function useDeleteHealthSubject(workspaceId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (subjectId: string) => api.deleteHealthSubject(workspaceId as string, subjectId), onSuccess: refresh });
}

export function useHealthGrants(workspaceId: string | undefined, subjectId: string | undefined, enabled = true) {
  const { api } = useCore();
  return useQuery<HealthGrant[]>({
    queryKey: [...root(workspaceId), "grants", subjectId],
    queryFn: () => api.listHealthGrants(workspaceId as string, subjectId as string),
    enabled: Boolean(workspaceId && subjectId && enabled)
  });
}

export function usePutHealthGrant(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ granteeUserId, input }: { granteeUserId: string; input: PutHealthGrantInput }) => api.putHealthGrant(workspaceId as string, subjectId as string, granteeUserId, input),
    onSuccess: refresh
  });
}

export function useRemoveHealthGrant(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (granteeUserId: string) => api.removeHealthGrant(workspaceId as string, subjectId as string, granteeUserId), onSuccess: refresh });
}

export function useHealthAppointments(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  return useQuery<HealthAppointment[]>({
    queryKey: [...root(workspaceId), "appointments", subjectId],
    queryFn: () => api.listHealthAppointments(workspaceId as string, subjectId as string),
    enabled: Boolean(workspaceId && subjectId)
  });
}

export function useCreateHealthAppointment(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthAppointmentInput) => api.createHealthAppointment(workspaceId as string, subjectId as string, input), onSuccess: refresh });
}

export function useUpdateHealthAppointment(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHealthAppointmentInput }) => api.updateHealthAppointment(workspaceId as string, subjectId as string, id, input),
    onSuccess: refresh
  });
}

export function useDeleteHealthAppointment(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (id: string) => api.deleteHealthAppointment(workspaceId as string, subjectId as string, id), onSuccess: refresh });
}

export function useHealthPreventive(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  return useQuery<HealthPreventiveItem[]>({
    queryKey: [...root(workspaceId), "preventive", subjectId],
    queryFn: () => api.listHealthPreventive(workspaceId as string, subjectId as string),
    enabled: Boolean(workspaceId && subjectId)
  });
}

export function useCreateHealthPreventive(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthPreventiveInput) => api.createHealthPreventive(workspaceId as string, subjectId as string, input), onSuccess: refresh });
}

export function useUpdateHealthPreventive(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHealthPreventiveInput }) => api.updateHealthPreventive(workspaceId as string, subjectId as string, id, input),
    onSuccess: refresh
  });
}

export function useMarkHealthPreventiveDone(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkHealthPreventiveDoneInput }) => api.markHealthPreventiveDone(workspaceId as string, subjectId as string, id, input),
    onSuccess: refresh
  });
}

export function useDeleteHealthPreventive(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (id: string) => api.deleteHealthPreventive(workspaceId as string, subjectId as string, id), onSuccess: refresh });
}
