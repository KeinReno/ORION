import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  agentEventCreateSchema,
  agentEventPatchSchema,
  createAgentJobInputSchema,
  createAgentProposalInputSchema,
  createAgentTokenInputSchema,
  updateAgentJobInputSchema,
  sendAgentMessageInputSchema,
  createNoteInputSchema,
  createTaskInputSchema,
  noteViewSchema,
  updateNoteInputSchema,
  updateTaskInputSchema,
  type AgentAuditEntry,
  type AgentEventCreate,
  type AgentEventPatch,
  type Event,
  type AgentJob,
  type AgentProposal,
  type CreateAgentJobInput,
  type CreateAgentProposalInput,
  type UpdateAgentJobInput,
  type AgentMessage,
  type AgentPeer,
  type SendAgentMessageInput,
  type AgentScope,
  type AgentToken,
  type CreateAgentTokenInput,
  type CreateNoteInput,
  type CreateTaskInput,
  type CreatedAgentToken,
  type Note,
  type OrionModuleId,
  type Project,
  type Task,
  type UpdateNoteInput,
  type UpdateTaskInput
} from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { EventsService } from "../events/events.service";
import { ModulesService } from "../modules/modules.service";
import { NotesService } from "../notes/notes.service";
import { ProjectsService } from "../projects/projects.service";
import { TasksService } from "../tasks/tasks.service";
import { AgentTokenGuard, type AgentRequest } from "./agent-token.guard";
import { AgentJobsService } from "./agent-jobs.service";
import { AgentTokensService, type AgentContext } from "./agent-tokens.service";

/** Everything an agent may change on a task — no delete, no reassignment, no dependency rewiring. */
const agentTaskPatchSchema = updateTaskInputSchema.pick({
  title: true,
  description: true,
  status: true,
  priority: true,
  dueAt: true,
  expectedRevision: true
});
const agentNotePatchSchema = updateNoteInputSchema.pick({
  title: true,
  summary: true,
  body: true,
  tags: true,
  expectedRevision: true
});

/** Token management for the signed-in member. The secret is returned once, by `POST`. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/agent-tokens")
export class AgentTokensController {
  constructor(
    private readonly tokens: AgentTokensService,
    private readonly jobs: AgentJobsService
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentToken[]> {
    return this.tokens.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createAgentTokenInputSchema)) body: CreateAgentTokenInput
  ): Promise<CreatedAgentToken> {
    return this.tokens.create(user.userId, workspaceId, body);
  }

  @Get("audit")
  audit(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentAuditEntry[]> {
    return this.tokens.audit(user.userId, workspaceId);
  }

  @Get("proposals")
  proposals(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentProposal[]> {
    return this.jobs.listProposals(user.userId, workspaceId);
  }

  @Post("proposals/:proposalId/approve")
  approve(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("proposalId") proposalId: string
  ): Promise<AgentProposal> {
    return this.jobs.approve(user.userId, workspaceId, proposalId);
  }

  @Post("proposals/:proposalId/reject")
  reject(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("proposalId") proposalId: string
  ): Promise<AgentProposal> {
    return this.jobs.reject(user.userId, workspaceId, proposalId);
  }

  @Delete(":tokenId")
  @HttpCode(204)
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tokenId") tokenId: string
  ): Promise<void> {
    return this.tokens.revoke(user.userId, workspaceId, tokenId);
  }
}

/**
 * The agent-facing API (ADR-0007). Every call: authenticate the token → check the scope →
 * check the module is on → run the ordinary service as the token's owner (so RLS and
 * membership still decide) → write an audit entry, success or failure. There is no
 * delete here by design: destructive actions stay with a human.
 */
@UseGuards(AgentTokenGuard)
@Controller("ai/v1")
export class AiController {
  constructor(
    private readonly tokens: AgentTokensService,
    private readonly jobs: AgentJobsService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService,
    private readonly notes: NotesService,
    private readonly projects: ProjectsService,
    private readonly events: EventsService
  ) {}

  @Get("me")
  me(@Req() req: AgentRequest): { tokenName: string; workspaceId: string; scopes: AgentScope[] } {
    const agent = req.agent as AgentContext;
    return { tokenName: agent.tokenName, workspaceId: agent.workspaceId, scopes: agent.scopes };
  }

  @Get("tasks")
  listTasks(@Req() req: AgentRequest, @Query("search") search?: string): Promise<Task[]> {
    return this.run(req, "tasks:read", "tasks", "tasks.list", null, (a) => this.tasks.list(a.userId, a.workspaceId, search));
  }

  @Post("tasks")
  createTask(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createTaskInputSchema)) body: CreateTaskInput
  ): Promise<Task> {
    return this.run(req, "tasks:write", "tasks", "tasks.create", null, (a) => this.tasks.create(a.userId, a.workspaceId, body, a.tokenName));
  }

  @Patch("tasks/:taskId")
  updateTask(
    @Req() req: AgentRequest,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(agentTaskPatchSchema)) body: UpdateTaskInput
  ): Promise<Task> {
    return this.run(req, "tasks:write", "tasks", "tasks.update", `task:${taskId}`, (a) =>
      this.tasks.update(a.userId, a.workspaceId, taskId, body, a.tokenName)
    );
  }

  @Get("notes")
  listNotes(@Req() req: AgentRequest, @Query("search") search?: string): Promise<Note[]> {
    return this.run(req, "notes:read", "notes", "notes.list", null, (a) =>
      this.notes.list(a.userId, a.workspaceId, search, noteViewSchema.parse("active"))
    );
  }

  @Get("notes/:noteId")
  getNote(@Req() req: AgentRequest, @Param("noteId") noteId: string): Promise<Note> {
    return this.run(req, "notes:read", "notes", "notes.get", `note:${noteId}`, (a) =>
      this.notes.getOne(a.userId, a.workspaceId, noteId)
    );
  }

  @Post("notes")
  createNote(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createNoteInputSchema)) body: CreateNoteInput
  ): Promise<Note> {
    return this.run(req, "notes:write", "notes", "notes.create", null, (a) => this.notes.create(a.userId, a.workspaceId, body, a.tokenName));
  }

  @Patch("notes/:noteId")
  updateNote(
    @Req() req: AgentRequest,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(agentNotePatchSchema)) body: UpdateNoteInput
  ): Promise<Note> {
    return this.run(req, "notes:write", "notes", "notes.update", `note:${noteId}`, (a) =>
      this.notes.update(a.userId, a.workspaceId, noteId, body, a.tokenName)
    );
  }

  /** Window `[from, to)`; defaults to the next 30 days, at most 366 days wide. Recurring events come expanded. */
  @Get("events")
  listEvents(@Req() req: AgentRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<Event[]> {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 30 * 24 * 3600 * 1000);
    return this.run(req, "events:read", "calendar", "events.list", null, (a) => {
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        throw new BadRequestException("Некорректное окно запроса (from/to)");
      }
      if (end.getTime() - start.getTime() > 366 * 24 * 3600 * 1000) throw new BadRequestException("Окно не шире 366 дней");
      return this.events.list(a.userId, a.workspaceId, start.toISOString(), end.toISOString());
    });
  }

  @Post("events")
  createEvent(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(agentEventCreateSchema)) body: AgentEventCreate
  ): Promise<Event> {
    return this.run(req, "events:write", "calendar", "events.create", null, (a) => this.events.create(a.userId, a.workspaceId, body));
  }

  @Patch("events/:eventId")
  updateEvent(
    @Req() req: AgentRequest,
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(agentEventPatchSchema)) body: AgentEventPatch
  ): Promise<Event> {
    return this.run(req, "events:write", "calendar", "events.update", `event:${eventId}`, (a) =>
      this.events.update(a.userId, a.workspaceId, eventId, body, "all")
    );
  }

  @Get("agents")
  listAgents(@Req() req: AgentRequest): Promise<AgentPeer[]> {
    return this.run(req, "agents:message", null, "agents.list", null, (a) => this.tokens.peers(a));
  }

  @Get("messages")
  inbox(@Req() req: AgentRequest): Promise<AgentMessage[]> {
    return this.run(req, "agents:message", null, "messages.inbox", null, (a) => this.tokens.inbox(a));
  }

  @Post("messages")
  sendMessage(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(sendAgentMessageInputSchema)) body: SendAgentMessageInput
  ): Promise<AgentMessage> {
    return this.run(req, "agents:message", null, "messages.send", `agent:${body.toTokenId}`, (a) => this.tokens.sendMessage(a, body));
  }

  @Post("messages/:messageId/read")
  @HttpCode(204)
  markRead(@Req() req: AgentRequest, @Param("messageId") messageId: string): Promise<void> {
    return this.run(req, "agents:message", null, "messages.read", `message:${messageId}`, (a) => this.tokens.markRead(a, messageId));
  }

  @Get("jobs")
  listJobs(@Req() req: AgentRequest): Promise<AgentJob[]> {
    return this.run(req, "agents:delegate", null, "jobs.list", null, (a) => this.jobs.listJobs(a));
  }

  @Post("jobs")
  createJob(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createAgentJobInputSchema)) body: CreateAgentJobInput
  ): Promise<AgentJob> {
    return this.run(req, "agents:delegate", null, "jobs.create", `agent:${body.toTokenId}`, (a) => this.jobs.createJob(a, body));
  }

  @Patch("jobs/:jobId")
  updateJob(
    @Req() req: AgentRequest,
    @Param("jobId") jobId: string,
    @Body(new ZodValidationPipe(updateAgentJobInputSchema)) body: UpdateAgentJobInput
  ): Promise<AgentJob> {
    return this.run(req, "agents:delegate", null, "jobs.update", `job:${jobId}`, (a) => this.jobs.updateJob(a, jobId, body));
  }

  /** Deletion is never executed for an agent: it files a request a human approves in Settings. */
  @Post("proposals")
  propose(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createAgentProposalInputSchema)) body: CreateAgentProposalInput
  ): Promise<AgentProposal> {
    const scope: AgentScope = body.action === "task.delete" ? "tasks:write" : "notes:write";
    const moduleId: OrionModuleId = body.action === "task.delete" ? "tasks" : "notes";
    return this.run(req, scope, moduleId, "proposals.create", `${body.action}:${body.targetId}`, (a) => this.jobs.propose(a, body));
  }

  @Get("projects")
  listProjects(@Req() req: AgentRequest): Promise<Project[]> {
    return this.run(req, "projects:read", "projects", "projects.list", null, (a) => this.projects.list(a.userId, a.workspaceId));
  }

  private async run<T>(
    req: AgentRequest,
    scope: AgentScope,
    moduleId: OrionModuleId | null,
    action: string,
    resource: string | null,
    fn: (agent: AgentContext) => Promise<T>
  ): Promise<T> {
    const agent = req.agent as AgentContext;
    try {
      if (!agent.scopes.includes(scope)) throw new ForbiddenException(`У токена нет разрешения «${scope}»`);
      if (moduleId) await this.modules.assertEnabled(agent.userId, agent.workspaceId, moduleId);
      const result = await fn(agent);
      await this.tokens.record(agent, action, resource, 200);
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      await this.tokens.record(agent, action, resource, status);
      throw error;
    }
  }
}
