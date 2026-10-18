"use client";

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
 * Хуки модуля Pet Care. Ходят через `ApiClient.extensionRequest` (G5/G24), поэтому модуль не правит
 * `@orion/core` / `@orion/core-react`. Ключи кэша — `["pet-care", ...]`.
 */
const base = (workspaceId: string) => `/workspaces/${workspaceId}/pet-care`;

export function usePetCarePets(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<PetCarePet[]>({
    queryKey: ["pet-care", workspaceId, "pets"],
    queryFn: () => api.extensionRequest("GET", `${base(workspaceId as string)}/pets`, undefined, petCarePetSchema.array()),
    enabled: Boolean(workspaceId)
  });
}

export function useCreatePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetCarePetInput) =>
      api.extensionRequest("POST", `${base(workspaceId as string)}/pets`, input, petCarePetSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "pets"] })
  });
}

export function useUpdatePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ petId, input }: { petId: string; input: UpdatePetCarePetInput }) =>
      api.extensionRequest("PATCH", `${base(workspaceId as string)}/pets/${petId}`, input, petCarePetSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "pets"] })
  });
}

export function useDeletePetCarePet(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (petId: string) =>
      api.extensionRequest("DELETE", `${base(workspaceId as string)}/pets/${petId}`, undefined, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId] })
  });
}

export function usePetCareEntries(workspaceId: string | undefined, petId: string | undefined) {
  const { api } = useCore();
  return useQuery<PetCareEntry[]>({
    queryKey: ["pet-care", workspaceId, "entries", petId],
    queryFn: () =>
      api.extensionRequest("GET", `${base(workspaceId as string)}/pets/${petId}/entries`, undefined, petCareEntrySchema.array()),
    enabled: Boolean(workspaceId && petId)
  });
}

export function useCreatePetCareEntry(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetCareEntryInput) =>
      api.extensionRequest("POST", `${base(workspaceId as string)}/pets/${petId}/entries`, input, petCareEntrySchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "entries", petId] })
  });
}

export function useDeletePetCareEntry(workspaceId: string | undefined, petId: string) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      api.extensionRequest("DELETE", `${base(workspaceId as string)}/pets/${petId}/entries/${entryId}`, undefined, petCareNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pet-care", workspaceId, "entries", petId] })
  });
}
