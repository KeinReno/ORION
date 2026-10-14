"use client";

import type { ContactCard, CreateContactCardInput, UpdateContactCardInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Module «Контакты». One cache, `["contacts", ws]`; a change also refreshes
 * «Дом» (`["home", ws]`), because a home's contacts are the same rows.
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
