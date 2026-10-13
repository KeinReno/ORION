"use client";

import type {
  AttachToHomeInput,
  Contact,
  CreateContactInput,
  CreateHomeInput,
  CreateMeterInput,
  CreateMeterReadingInput,
  Home,
  HomeOverview,
  Meter,
  UpdateContactInput,
  UpdateHomeInput,
  UpdateMeterInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useHomes(workspaceId: string | undefined, archived = false) {
  const { api } = useCore();
  return useQuery<Home[]>({
    queryKey: ["home", workspaceId, "list", archived],
    queryFn: () => api.listHomes(workspaceId as string, archived),
    enabled: Boolean(workspaceId)
  });
}

/** Everything on one home's page; the four id lists point into the ordinary tasks / lists / inventory / payments hooks. */
export function useHomeOverview(workspaceId: string | undefined, homeId: string | undefined) {
  const { api } = useCore();
  return useQuery<HomeOverview>({
    queryKey: ["home", workspaceId, "overview", homeId],
    queryFn: () => api.homeOverview(workspaceId as string, homeId as string),
    enabled: Boolean(workspaceId && homeId)
  });
}

/** Re-reads the Home page after something was created or attached from it (or elsewhere). */
export function useRefreshHome(workspaceId: string | undefined): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["home", workspaceId] });
}

function useHomeMutation<V, R>(workspaceId: string | undefined, fn: (workspaceId: string, variables: V) => Promise<R>) {
  const refresh = useRefreshHome(workspaceId);
  return useMutation<R, Error, V>({
    mutationFn: (variables) => fn(workspaceId as string, variables),
    onSuccess: refresh
  });
}

export function useCreateHome(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, input: CreateHomeInput) => api.createHome(ws, input));
}

export function useUpdateHome(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, v: { homeId: string; input: UpdateHomeInput }) => api.updateHome(ws, v.homeId, v.input));
}

export function useDeleteHome(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (homeId) => api.deleteHome(workspaceId as string, homeId),
    // Chores, lists, things and payments only lose their link: re-read them too.
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useAttachToHome(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation<void, Error, { homeId: string; input: AttachToHomeInput; attach: boolean }>({
    mutationFn: (v) => (v.attach ? api.attachToHome(workspaceId as string, v.homeId, v.input) : api.detachFromHome(workspaceId as string, v.homeId, v.input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home", workspaceId] })
  });
}

export function useCreateMeter(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, v: { homeId: string; input: CreateMeterInput }) => api.createMeter(ws, v.homeId, v.input));
}

export function useUpdateMeter(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, v: { homeId: string; meterId: string; input: UpdateMeterInput }) => api.updateMeter(ws, v.homeId, v.meterId, v.input));
}

export function useDeleteMeter(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, v: { homeId: string; meterId: string }) => api.deleteMeter(ws, v.homeId, v.meterId));
}

export function useAddMeterReading(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation<{ homeId: string; meterId: string; input: CreateMeterReadingInput }, Meter>(workspaceId, (ws, v) =>
    api.addMeterReading(ws, v.homeId, v.meterId, v.input)
  );
}

export function useDeleteMeterReading(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation<{ homeId: string; meterId: string; readingId: string }, Meter>(workspaceId, (ws, v) =>
    api.deleteMeterReading(ws, v.homeId, v.meterId, v.readingId)
  );
}

export function useCreateContact(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation<{ homeId: string; input: CreateContactInput }, Contact>(workspaceId, (ws, v) => api.createContact(ws, v.homeId, v.input));
}

export function useUpdateContact(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation<{ homeId: string; contactId: string; input: UpdateContactInput }, Contact>(workspaceId, (ws, v) =>
    api.updateContact(ws, v.homeId, v.contactId, v.input)
  );
}

export function useDeleteContact(workspaceId: string | undefined) {
  const { api } = useCore();
  return useHomeMutation(workspaceId, (ws, v: { homeId: string; contactId: string }) => api.deleteContact(ws, v.homeId, v.contactId));
}
