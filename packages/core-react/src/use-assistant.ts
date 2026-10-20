"use client";

import type { AssistantChatInput, AssistantChatResult, AssistantKeyStatus, AssistantSendInput, SetAssistantKeyInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/** Чат-ассистент внутри ORION (ADR-0017, вариант C). */
export function useAssistantKey() {
  const { api } = useCore();
  return useQuery<AssistantKeyStatus>({ queryKey: ["assistant", "key"], queryFn: () => api.getAssistantKeyStatus() });
}

export function useSaveAssistantKey() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetAssistantKeyInput) => api.saveAssistantKey(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant", "key"] })
  });
}

export function useAssistantConversations(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["assistant", "conversations", workspaceId],
    queryFn: () => api.listAssistantConversations(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

export function useAssistantConversation(workspaceId: string | undefined, id: string | null) {
  const { api } = useCore();
  return useQuery({
    queryKey: ["assistant", "conversation", workspaceId, id],
    queryFn: () => api.getAssistantConversation(workspaceId as string, id as string),
    enabled: Boolean(workspaceId && id)
  });
}

export function useSendToAssistant(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AssistantSendInput) => api.sendToAssistant(workspaceId as string, input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["assistant", "conversations", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["assistant", "conversation", workspaceId, result.conversationId] });
    }
  });
}

/** Upload files for the next assistant message; the documents list is refreshed (they appear in the inbox folder). */
export function useUploadToAssistant(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => api.uploadToAssistantInbox(workspaceId as string, files),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] })
  });
}

export function useDeleteAssistantConversation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAssistantConversation(workspaceId as string, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant", "conversations", workspaceId] })
  });
}

export function useSetAssistantModel() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => api.setAssistantModel(model),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant", "key"] })
  });
}

export function useClearAssistantKey() {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.clearAssistantKey(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant", "key"] })
  });
}

/** Отправка обмена. Действия ассистента меняют задачи и заметки — кэши предметных модулей обновляем после ответа. */
export function useAssistantChat(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<AssistantChatResult, Error, AssistantChatInput>({
    mutationFn: (input) => api.assistantChat(workspaceId as string, input),
    onSuccess: (result) => {
      if (result.actions.some((action) => action.ok)) {
        for (const key of ["notes", "tasks", "events", "inbox", "projects"]) void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
  });
}
