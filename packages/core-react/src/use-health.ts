"use client";

import type {
  CreateHealthSymptomInput,
  HealthSummary,
  HealthSymptom,
  UpdateHealthSymptomInput,
  CreateHealthMeasurementInput,
  HealthMeasurement,
  HealthMeasurementKind,
  HealthTarget,
  PutHealthTargetInput,
  CreateHealthMedicationInput,
  HealthDose,
  HealthMedication,
  UpdateHealthMedicationInput,
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

export function useHealthMedications(workspaceId: string | undefined, subjectId: string | undefined, today: string) {
  const { api } = useCore();
  return useQuery<HealthMedication[]>({
    queryKey: [...root(workspaceId), "medications", subjectId, today],
    queryFn: () => api.listHealthMedications(workspaceId as string, subjectId as string, today),
    enabled: Boolean(workspaceId && subjectId)
  });
}

/** Слоты расписания на день с отметками (`day` — день клиента). */
export function useHealthSchedule(workspaceId: string | undefined, subjectId: string | undefined, day: string) {
  const { api } = useCore();
  return useQuery<HealthDose[]>({
    queryKey: [...root(workspaceId), "schedule", subjectId, day],
    queryFn: () => api.healthSchedule(workspaceId as string, subjectId as string, day),
    enabled: Boolean(workspaceId && subjectId)
  });
}

export function useCreateHealthMedication(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthMedicationInput) => api.createHealthMedication(workspaceId as string, subjectId as string, input), onSuccess: refresh });
}

export function useUpdateHealthMedication(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHealthMedicationInput }) => api.updateHealthMedication(workspaceId as string, subjectId as string, id, input),
    onSuccess: refresh
  });
}

/** Отметить приём (`taken`/`skipped`) или снять отметку (`status: null`). Работает для любого человека — `subjectId` в аргументах. */
export function useMarkHealthIntake(workspaceId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ subjectId, medicationId, day, time, status }: { subjectId: string; medicationId: string; day: string; time: string; status: "taken" | "skipped" | null }) =>
      status === null
        ? api.removeHealthIntake(workspaceId as string, subjectId, medicationId, day, time)
        : api.putHealthIntake(workspaceId as string, subjectId, medicationId, { day, time, status }),
    onSuccess: refresh
  });
}

/** Показатели одного человека; `from` — ISO-момент начала окна (на сервере режутся до 3000 записей, свежие первыми). */
export function useHealthMeasurements(workspaceId: string | undefined, subjectId: string | undefined, kind: HealthMeasurementKind, from?: string) {
  const { api } = useCore();
  return useQuery<HealthMeasurement[]>({
    queryKey: [...root(workspaceId), "measurements", subjectId, kind, from ?? "all"],
    queryFn: () => api.listHealthMeasurements(workspaceId as string, subjectId as string, { kind, from }),
    enabled: Boolean(workspaceId && subjectId)
  });
}

export function useCreateHealthMeasurement(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthMeasurementInput) => api.createHealthMeasurement(workspaceId as string, subjectId as string, input), onSuccess: refresh });
}

export function useDeleteHealthMeasurement(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (id: string) => api.deleteHealthMeasurement(workspaceId as string, subjectId as string, id), onSuccess: refresh });
}

export function useHealthTargets(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  return useQuery<HealthTarget[]>({
    queryKey: [...root(workspaceId), "targets", subjectId],
    queryFn: () => api.listHealthTargets(workspaceId as string, subjectId as string),
    enabled: Boolean(workspaceId && subjectId)
  });
}

/** Задать личный диапазон; обе границы `null` — убрать диапазон. */
export function usePutHealthTarget(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: async ({ kind, input }: { kind: HealthMeasurementKind; input: PutHealthTargetInput }): Promise<void> => {
      if (input.min === null && input.max === null) await api.deleteHealthTarget(workspaceId as string, subjectId as string, kind);
      else await api.putHealthTarget(workspaceId as string, subjectId as string, kind, input);
    },
    onSuccess: refresh
  });
}

export function useHealthSymptoms(workspaceId: string | undefined, subjectId: string | undefined, from?: string) {
  const { api } = useCore();
  return useQuery<HealthSymptom[]>({
    queryKey: [...root(workspaceId), "symptoms", subjectId, from ?? "all"],
    queryFn: () => api.listHealthSymptoms(workspaceId as string, subjectId as string, from),
    enabled: Boolean(workspaceId && subjectId)
  });
}

export function useCreateHealthSymptom(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (input: CreateHealthSymptomInput) => api.createHealthSymptom(workspaceId as string, subjectId as string, input), onSuccess: refresh });
}

export function useUpdateHealthSymptom(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateHealthSymptomInput }) => api.updateHealthSymptom(workspaceId as string, subjectId as string, id, input),
    onSuccess: refresh
  });
}

export function useDeleteHealthSymptom(workspaceId: string | undefined, subjectId: string | undefined) {
  const { api } = useCore();
  const refresh = useRefresh(workspaceId);
  return useMutation({ mutationFn: (id: string) => api.deleteHealthSymptom(workspaceId as string, subjectId as string, id), onSuccess: refresh });
}

/** Свежая сводка по нажатию «Распечатать»: запрос идёт в момент действия, а не фоном. */
export function useFetchHealthSummary(workspaceId: string | undefined) {
  const { api } = useCore();
  return useMutation<HealthSummary, Error, string>({ mutationFn: (subjectId: string) => api.healthSummary(workspaceId as string, subjectId) });
}
