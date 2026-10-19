"use client";

import type { BackgroundJobStatus, ComponentDataStatus } from "@orion/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useCore } from "./provider";

/** G16 — данные менеджера компонентов: состояние миграций (G11) и фоновых задач (G9). */
export function useComponentData() {
  const { api } = useCore();
  return useQuery<ComponentDataStatus[]>({ queryKey: ["system", "components"], queryFn: () => api.listComponentData() });
}

export function useBackgroundJobs() {
  const { api } = useCore();
  return useQuery<BackgroundJobStatus[]>({ queryKey: ["system", "jobs"], queryFn: () => api.listBackgroundJobs() });
}
