"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import { architectSnapshotSummarySchema, taskCommitLinkSchema, taskTraceSchema, type TaskCommitLink } from "@orion/shared-types";
import { Button, Skeleton } from "@orion/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskDetailTabSlotProps } from "../../lib/extensions/contracts";
import { describeError } from "../../lib/extensions/host-api";

export function TaskDevelopmentTrace({ workspaceId, taskId }: TaskDetailTabSlotProps): React.ReactElement {
  const { api } = useCore();
  const queryClient = useQueryClient();
  const tasks = () => createModuleClient(api, workspaceModuleBase(workspaceId ?? "", "tasks"));
  const path = `/${encodeURIComponent(taskId)}`;
  const queryKey = ["task-development-trace", workspaceId, taskId];
  const trace = useQuery({
    queryKey,
    queryFn: () => tasks().get(`${path}/trace`, taskTraceSchema),
    enabled: Boolean(workspaceId)
  });
  const links = useQuery({
    queryKey: ["task-commit-links", workspaceId, taskId],
    queryFn: () => tasks().get(`${path}/commit-links`, taskCommitLinkSchema.array()),
    enabled: Boolean(workspaceId)
  });
  const analyze = useMutation({
    mutationFn: (link: TaskCommitLink) => createModuleClient(api, workspaceModuleBase(workspaceId ?? "", "development/architect"))
      .post(`/${encodeURIComponent(link.repositoryId)}/snapshots`, { ref: link.sha }, architectSnapshotSummarySchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });
  if (!workspaceId) return <p>Рабочее пространство не выбрано.</p>;
  if (trace.isPending || links.isPending) return <Skeleton className="h-16 w-full" />;
  if (trace.isError || links.isError) return <p role="alert">{describeError(trace.error ?? links.error)}</p>;
  const checks = trace.data.entries.filter((entry) => entry.kind === "check" && !entry.placeholder);
  return (
    <div className="space-y-3 text-label">
      {links.data.length === 0 ? <p>С задачей пока нет связанных коммитов.</p> : (
        <ul className="space-y-2">
          {links.data.map((link) => {
            const check = checks.find((entry) => entry.links.some((ref) => ref.type === "commit" && ref.id === link.sha)
              && entry.links.some((ref) => ref.type === "repository" && ref.id === link.repositoryId));
            return (
              <li key={link.id} className="space-y-1 rounded-md border border-border p-3">
                <p className="break-words"><span className="font-mono" title={link.sha}>{link.sha.slice(0, 8)}</span> · {link.subject}</p>
                {check ? <p>{check.status}{check.detail ? ` · ${check.detail}` : ""}</p> : (
                  <Button size="sm" variant="subtle" disabled={analyze.isPending} onClick={() => analyze.mutate(link)}>Запустить структурный анализ</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {analyze.isError ? <p role="alert">{describeError(analyze.error)}</p> : null}
    </div>
  );
}
