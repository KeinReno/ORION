"use client";

import type { AssistantChatInput, AssistantChatResult, AssistantKeyStatus, SetAssistantKeyInput } from "@orion/shared-types";
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
