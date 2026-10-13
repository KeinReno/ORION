"use client";

import type { AddGoalPlanInput, CreateGoalInput, Goal, UpdateGoalInput } from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCore } from "./provider";

export function useProjectGoals(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<Goal[]>({
    queryKey: ["goals", workspaceId],
    queryFn: () => api.listProjectGoals(workspaceId as string),
    enabled: Boolean(workspaceId)
  });
}

function useProjectGoalMutation<V, R>(workspaceId: string | undefined, fn: (workspaceId: string, variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation<R, Error, V>({
    mutationFn: (variables) => fn(workspaceId as string, variables),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals", workspaceId] })
  });
}

export function useCreateProjectGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, input: CreateGoalInput) => api.createProjectGoal(ws, input));
}

export function useUpdateProjectGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, v: { goalId: string; input: UpdateGoalInput }) => api.updateProjectGoal(ws, v.goalId, v.input));
}

export function useDeleteProjectGoal(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, goalId: string) => api.deleteProjectGoal(ws, goalId));
}

export function useAddProjectGoalPlan(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, v: { goalId: string; input: AddGoalPlanInput }) => api.addProjectGoalPlan(ws, v.goalId, v.input));
}

export function useUpdateProjectGoalPlan(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, v: { goalId: string; planId: string; weight: number }) =>
    api.updateProjectGoalPlan(ws, v.goalId, v.planId, { weight: v.weight })
  );
}

export function useRemoveProjectGoalPlan(workspaceId: string | undefined) {
  const { api } = useCore();
  return useProjectGoalMutation(workspaceId, (ws, v: { goalId: string; planId: string }) => api.removeProjectGoalPlan(ws, v.goalId, v.planId));
}
