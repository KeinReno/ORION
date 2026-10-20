import { Body, Controller, OnModuleInit, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { createProjectInputSchema, updateProjectInputSchema, type CreateProjectInput, type Project } from "@orion/shared-types";
import type { Response } from "express";
import { AgentModuleToolsService, type ModuleChangeResult } from "../ai/agent-module-tools.service";
import { AgentTokenGuard, type AgentRequest } from "../ai/agent-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ProjectsService } from "./projects.service";

const projectChangeSchema = updateProjectInputSchema.pick({
  name: true,
  description: true,
  status: true,
  startAt: true,
  dueAt: true,
  budgetAmount: true,
  hourlyRate: true
});

const PROJECT_LABELS = { name: "Название", description: "Описание", status: "Статус", startAt: "Начало", dueAt: "Срок", budgetAmount: "Бюджет, коп.", hourlyRate: "Ставка, коп./ч" };

/**
 * Инструменты ИИ-агента: создание и правка проектов (G13; список проектов — в основном шлюзе `orion_list_projects`).
 * Разрешение, режим, включённость модуля, лимит записи и журнал — в `AgentModuleToolsService`.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1/projects")
export class ProjectsAgentController implements OnModuleInit {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tools: AgentModuleToolsService
  ) {}

  onModuleInit(): void {
    this.tools.register("orion_projects_update", {
      noun: "проект",
      describe: async (userId, workspaceId, projectId) => {
        const project = await this.projects.get(userId, workspaceId, projectId).catch(() => null);
        if (!project) return null;
        const fields = Object.fromEntries(Object.keys(PROJECT_LABELS).map((key) => [key, (project as unknown as Record<string, unknown>)[key]]));
        return { title: project.name, fields, labels: PROJECT_LABELS };
      },
      apply: (userId, workspaceId, projectId, args) => this.projects.update(userId, workspaceId, projectId, projectChangeSchema.parse(args))
    });
  }

  @Post()
  create(@Req() req: AgentRequest, @Body(new ZodValidationPipe(createProjectInputSchema)) body: CreateProjectInput): Promise<Project> {
    return this.tools.run(
      req,
      "orion_projects_create",
      (agent) => this.projects.create(agent.userId, agent.workspaceId, body),
      (project) => ({ resource: `project:${project.id}`, objectType: "project", objectId: project.id, summary: `Создал проект «${project.name}»` })
    );
  }

  @Patch(":projectId")
  update(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(projectChangeSchema)) body: Record<string, unknown>
  ): Promise<ModuleChangeResult> {
    return this.tools.change(req, res, "orion_projects_update", projectId, body);
  }
}
