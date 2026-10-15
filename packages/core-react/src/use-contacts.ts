"use client";

import type {
  BulkContactsInput,
  BulkContactsResult,
  ContactCard,
  ContactInteraction,
  ContactRelation,
  CreateContactCardInput,
  CreateContactInteractionInput,
  CreateContactRelationInput,
  ImportContactsInput,
  ImportContactsResult,
  MergeContactsInput,
  UpdateContactCardInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Module «Контакты». One cache, `["contacts", ws]`; a change also refreshes
 * «Дом» (`["home", ws]`), because a home's contacts are the same rows. The
 * journal and the relations of one contact live under
 * `["contact-interactions", ws, id]` / `["contact-relations", ws, id]`.
 */
export function useContactCards(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<ContactCard[]>({
    queryKey: ["contacts", workspaceId],
    queryFn: () => api.listContactCards(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

function useInvalidateContacts(workspaceId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["contacts", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["home", workspaceId] });
  };
}

export function useCreateContactCard(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<ContactCard, Error, CreateContactCardInput>({
    mutationFn: (input) => api.createContactCard(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useUpdateContactCard(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<ContactCard, Error, { contactId: string; input: UpdateContactCardInput }>({
    mutationFn: ({ contactId, input }) => api.updateContactCard(workspaceId as string, contactId, input),
    onSuccess: invalidate
  });
}

export function useDeleteContactCard(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<void, Error, string>({
    mutationFn: (contactId) => api.deleteContactCard(workspaceId as string, contactId),
    onSuccess: invalidate
  });
}

export function useBulkContactCards(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<BulkContactsResult, Error, BulkContactsInput>({
    mutationFn: (input) => api.bulkContactCards(workspaceId as string, input),
    onSuccess: invalidate
  });
}

export function useImportContactCards(workspaceId: string | undefined) {
  const { api } = useCore();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<ImportContactsResult, Error, ImportContactsInput>({
    mutationFn: (input) => api.importContactCards(workspaceId as string, input),
    onSuccess: invalidate
  });
}

/** Merging also moves links, journal and reminders, so their caches go stale too. */
export function useMergeContactCards(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<ContactCard, Error, { contactId: string; input: MergeContactsInput }>({
    mutationFn: ({ contactId, input }) => api.mergeContactCards(workspaceId as string, contactId, input),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["contact-interactions", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["contact-relations", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["links", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["reminders", workspaceId] });
    }
  });
}

export function useContactInteractions(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  return useQuery<ContactInteraction[]>({
    queryKey: ["contact-interactions", workspaceId, contactId],
    queryFn: () => api.listContactInteractions(workspaceId as string, contactId as string),
    enabled: Boolean(workspaceId && contactId)
  });
}

/** Logging a contact also moves `lastContactedAt`, so the contact list is refreshed too. */
export function useCreateContactInteraction(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<ContactInteraction, Error, CreateContactInteractionInput>({
    mutationFn: (input) => api.createContactInteraction(workspaceId as string, contactId as string, input),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["contact-interactions", workspaceId, contactId] });
    }
  });
}

export function useDeleteContactInteraction(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateContacts(workspaceId);
  return useMutation<void, Error, string>({
    mutationFn: (interactionId) => api.deleteContactInteraction(workspaceId as string, contactId as string, interactionId),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["contact-interactions", workspaceId, contactId] });
    }
  });
}

export function useContactRelations(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  return useQuery<ContactRelation[]>({
    queryKey: ["contact-relations", workspaceId, contactId],
    queryFn: () => api.listContactRelations(workspaceId as string, contactId as string),
    enabled: Boolean(workspaceId && contactId)
  });
}

/** A relation shows on both contacts, so every contact's relation cache is refreshed. */
export function useCreateContactRelation(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<ContactRelation, Error, CreateContactRelationInput>({
    mutationFn: (input) => api.createContactRelation(workspaceId as string, contactId as string, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["contact-relations", workspaceId] })
  });
}

export function useDeleteContactRelation(workspaceId: string | undefined, contactId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (relationId) => api.deleteContactRelation(workspaceId as string, contactId as string, relationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["contact-relations", workspaceId] })
  });
}
