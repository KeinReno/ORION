"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  PROJECT_PORTFOLIO_DEFAULT_LIMIT,
  PROJECT_PORTFOLIO_RISK_LABEL,
  projectFromTemplateResultSchema,
  projectPortfolioSchema,
  projectTemplateSchema,
  type Task
} from "@orion/shared-types";
import { Button, Input, Modal, Select, Skeleton } from "@orion/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { openEntity, openProject } from "../../lib/panel-bus";

export function ProjectTemplateDialog({ workspaceId, close }: { workspaceId: string; close: () => void }): React.ReactElement {
  const { api } = useCore();
  const client = createModuleClient(api, workspaceModuleBase(workspaceId, "projects"));
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: ["project-templates", workspaceId],
    queryFn: () => client.get("/templates", projectTemplateSchema.array())
  });
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => client.post("/from-template", { templateId, name: name.trim() }, projectFromTemplateResultSchema),
    onSuccess: ({ projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["milestones", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["project-portfolio", workspaceId] });
      close();
      openProject(projectId);
    }
  });
  return (
    <Modal open onClose={() => { if (!create.isPending) close(); }} title="Проект из шаблона" size="sm">
      {templates.isPending ? <Skeleton className="h-20 w-full" /> : templates.isError ? (
        <p role="alert">{describeError(templates.error)}</p>
      ) : templates.data.length === 0 ? <p>В этом пространстве пока нет шаблонов проектов.</p> : (
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending && templateId && name.trim()) create.mutate();
        }}>
          <label className="flex flex-col gap-1">
            Шаблон
            <Select value={templateId} disabled={create.isPending} required onChange={(event) => {
              const template = templates.data.find((item) => item.id === event.target.value);
              setTemplateId(event.target.value);
              setName(template?.name ?? "");
            }}>
              <option value="">Выберите шаблон</option>
              {templates.data.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            Название проекта
            <Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={create.isPending} />
          </label>
          {create.isError ? <p role="alert" className="text-destructive">{describeError(create.error)}</p> : null}
          <Button type="submit" disabled={!templateId || !name.trim() || create.isPending}>Создать проект</Button>
        </form>
      )}
    </Modal>
  );
}

export function ProjectPortfolioDialog({ workspaceId, tasks, close }: { workspaceId: string; tasks: Task[]; close: () => void }): React.ReactElement {
  const { api } = useCore();
  const [offset, setOffset] = useState(0);
  const portfolio = useQuery({
    queryKey: ["project-portfolio", workspaceId, offset],
    queryFn: () => createModuleClient(api, workspaceModuleBase(workspaceId, "projects"))
      .get(`/portfolio?offset=${offset}`, projectPortfolioSchema)
  });
  return (
    <Modal open onClose={close} title="Портфель проектов" size="lg">
      {portfolio.isPending ? <Skeleton className="h-24 w-full" /> : portfolio.isError ? <p role="alert">{describeError(portfolio.error)}</p> : (
        <div className="space-y-4">
          <p>Проектов: {portfolio.data.totals.projects} · С риском: {portfolio.data.totals.projectsAtRisk} · Просрочено: {portfolio.data.totals.overdueProjects}</p>
          {portfolio.data.page.truncated ? <p className="text-warning">Сводка ограничена первыми 500 проектами.</p> : null}
          {portfolio.data.items.length === 0 ? <p>В портфеле пока нет проектов.</p> : null}
          <ul className="divide-y divide-border">
            {portfolio.data.items.map((project) => {
              const risks = portfolio.data.risks.filter((risk) => risk.projectId === project.id);
              const blocked = tasks.filter((task) => task.projectId === project.id && task.blocked && task.status !== "done" && task.status !== "canceled");
              return (
                <li key={project.id} className="space-y-1 py-3">
                  <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => { close(); openProject(project.id, project.name); }}>{project.name}</button>
                  <p className="text-label text-subtle-foreground">{project.progress}% завершено · Открыто задач: {project.openTasks}{project.dueAt ? ` · Срок ${shortDate(project.dueAt)}` : ""}</p>
                  {risks.map((risk, index) => <p key={`${risk.kind}:${index}`} className="text-label text-warning">{PROJECT_PORTFOLIO_RISK_LABEL[risk.kind]} · {risk.detail}</p>)}
                  {blocked.map((task) => <Button variant="subtle" size="sm" key={task.id} onClick={() => { close(); openEntity("task", task.id); }}>{task.title}</Button>)}
                </li>
              );
            })}
          </ul>
          {portfolio.data.page.total > PROJECT_PORTFOLIO_DEFAULT_LIMIT || offset > 0 ? (
            <div className="flex gap-2">
              <Button variant="subtle" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PROJECT_PORTFOLIO_DEFAULT_LIMIT))}>Назад</Button>
              <Button variant="subtle" disabled={offset + portfolio.data.page.limit >= portfolio.data.page.total} onClick={() => setOffset(offset + portfolio.data.page.limit)}>Далее</Button>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
