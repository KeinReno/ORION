"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  importMurhpResultSchema,
  murhpDatabaseReadSchema,
  petCareDayLogSchema,
  petCareEntrySchema,
  petCareEventSchema,
  petCareNoContentSchema,
  petCarePetSchema,
  type CreatePetCareEntryInput,
  type CreatePetCareEventInput,
  type CreatePetCarePetInput,
  type ImportMurhpDraft,
  type PetCareDayLog,
  type PetCareEntry,
  type PetCareEvent,
  type PetCarePet,
  type UpdatePetCarePetInput,
  type UpsertPetCareDayDraft
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Хуки модуля Pet Care. Ходят через `createModuleClient` поверх `ApiClient.extensionRequest` (G5/G24), поэтому модуль не правит
 * `@orion/core` / `@orion/core-react`. Ключи кэша — `["pet-care", ...]`.
 */
const petCare = (api: Parameters<typeof createModuleClient>[0], workspaceId: string) =>
  createModuleClient(api, workspaceModuleBase(workspaceId, "pet-care"));

export function usePetCarePets(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<PetCarePet[]>({
    queryKey: ["pet-care", workspaceId, "pets"],
    queryFn: () => petCare(api, workspaceId as string).get(`/pets`, petCarePetSchema.array()),
    enabled: Boolean(workspaceId)
  });
}

export function useCreatePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetCarePetInput) =>
      petCare(api, workspaceId as string).post(`/pets`, input, petCarePetSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "pets"] })
  });
}

export function useUpdatePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ petId, input }: { petId: string; input: UpdatePetCarePetInput }) =>
      petCare(api, workspaceId as string).patch(`/pets/${petId}`, input, petCarePetSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "pets"] })
  });
}

export function useDeletePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (petId: string) =>
      petCare(api, workspaceId as string).delete(`/pets/${petId}`, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId] })
  });
}

export function usePetCareEntries(workspaceId: string | undefined, petId: string | undefined) {
  const { api } = useCore();
  return useQuery<PetCareEntry[]>({
    queryKey: ["pet-care", workspaceId, "entries", petId],
    queryFn: () =>
      petCare(api, workspaceId as string).get(`/pets/${petId}/entries`, petCareEntrySchema.array()),
    enabled: Boolean(workspaceId && petId)
  });
}

export function useCreatePetCareEntry(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetCareEntryInput) =>
      petCare(api, workspaceId as string).post(`/pets/${petId}/entries`, input, petCareEntrySchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "entries", petId] })
  });
}

export function useDeletePetCareEntry(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      petCare(api, workspaceId as string).delete(`/pets/${petId}/entries/${entryId}`, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "entries", petId] })
  });
}

// ---------- Дневник самочувствия (перенос MurHP) ----------

const rangeQuery = (from: string, to: string) => `?from=${from}&to=${to}`;

/** Дни питомца в окне `from..to` (включительно, `ГГГГ-ММ-ДД`), по возрастанию даты. */
export function usePetCareDays(workspaceId: string | undefined, petId: string | undefined, from: string, to: string) {
  const { api } = useCore();
  return useQuery<PetCareDayLog[]>({
    queryKey: ["pet-care", workspaceId, "days", petId, from, to],
    queryFn: () => petCare(api, workspaceId as string).get(`/pets/${petId}/days${rangeQuery(from, to)}`, petCareDayLogSchema.array()),
    enabled: Boolean(workspaceId && petId)
  });
}

export function useSavePetCareDay(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ day, input }: { day: string; input: UpsertPetCareDayDraft }) =>
      petCare(api, workspaceId as string).put(`/pets/${petId}/days/${day}`, input, petCareDayLogSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "days", petId] })
  });
}

export function useDeletePetCareDay(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (day: string) => petCare(api, workspaceId as string).delete(`/pets/${petId}/days/${day}`, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "days", petId] })
  });
}

export function usePetCareEvents(workspaceId: string | undefined, petId: string | undefined, from: string, to: string) {
  const { api } = useCore();
  return useQuery<PetCareEvent[]>({
    queryKey: ["pet-care", workspaceId, "events", petId, from, to],
    queryFn: () => petCare(api, workspaceId as string).get(`/pets/${petId}/events${rangeQuery(from, to)}`, petCareEventSchema.array()),
    enabled: Boolean(workspaceId && petId)
  });
}

export function useCreatePetCareEvent(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetCareEventInput) => petCare(api, workspaceId as string).post(`/pets/${petId}/events`, input, petCareEventSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "events", petId] })
  });
}

export function useDeletePetCareEvent(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => petCare(api, workspaceId as string).delete(`/pets/${petId}/events/${eventId}`, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "events", petId] })
  });
}

/** MurHP's database file (`murhp.db`) → the same JSON as its «Экспорт копии»; reads only, the import is separate. */
export function useReadMurhpDatabase(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return petCare(api, workspaceId as string).post(`/pets/${petId}/murhp-db`, form, murhpDatabaseReadSchema);
    }
  });
}

export function useImportMurhp(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportMurhpDraft) => petCare(api, workspaceId as string).post(`/pets/${petId}/import-murhp`, input, importMurhpResultSchema),
    // Импорт трогает дни, события и профиль питомца сразу.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId] })
  });
}
