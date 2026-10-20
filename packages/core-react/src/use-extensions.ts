import type { ApproveExtensionInput, ExtensionInfo, ExtensionsState, UpdateExtensionInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

/**
 * Расширения из папки (ADR-0022, E2). `pollMs` — как часто перечитывать состояние: загрузчик интерфейса опрашивает часто,
 * пока у какого-то расширения включён режим разработчика (правка видна сразу), и редко в остальное время.
 */
export function useExtensions(options: { enabled?: boolean; pollMs?: number | false | ((state: ExtensionsState | undefined) => number | false) } = {}) {
  const { api } = useCore();
  const { pollMs } = options;
  return useQuery<ExtensionsState>({
    queryKey: ["extensions"],
    queryFn: () => api.getExtensions(),
    enabled: options.enabled ?? true,
    refetchInterval: typeof pollMs === "function" ? (query) => pollMs(query.state.data) : (pollMs ?? false),
    retry: false
  });
}

function useExtensionMutation<TInput>(run: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["extensions"] })
  });
}

export function useApproveExtension() {
  const { api } = useCore();
  return useExtensionMutation<{ id: string } & ApproveExtensionInput>(({ id, ...input }) => api.approveExtension(id, input) as Promise<ExtensionInfo>);
}

export function useUpdateExtension() {
  const { api } = useCore();
  return useExtensionMutation<{ id: string } & UpdateExtensionInput>(({ id, ...input }) => api.updateExtension(id, input));
}

export function useRevokeExtension() {
  const { api } = useCore();
  return useExtensionMutation<string>((id) => api.revokeExtension(id));
}

export function useOpenExtensionsFolder() {
  const { api } = useCore();
  return useMutation({ mutationFn: () => api.openExtensionsFolder() });
}
