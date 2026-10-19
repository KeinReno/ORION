"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  petCareEntrySchema,
  petCareNoContentSchema,
  petCarePetSchema,
  type CreatePetCareEntryInput,
  type CreatePetCarePetInput,
  type PetCareEntry,
  type PetCarePet,
  type UpdatePetCarePetInput
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
