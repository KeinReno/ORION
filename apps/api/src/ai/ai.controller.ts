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
  Res,
  UseGuards
} from "@nestjs/common";
import {
  AGENT_PROPOSAL_ACTION_LABEL,
  agentAuditQuerySchema,
  agentEventCreateSchema,
  agentNotePatchSchema,
  agentProposalApproveInputSchema,
  agentProposalBulkInputSchema,
  agentTaskPatchSchema,
  decideAgentOperation,
  isDecisionNote,
  updateAgentTokenInputSchema,
  agentFinanceDraftInputSchema,
  agentEventPatchSchema,
  createAgentJobInputSchema,
  createAgentProposalInputSchema,
  createAgentTokenInputSchema,
  updateAgentJobInputSchema,
  sendAgentMessageInputSchema,
  createNoteInputSchema,
  createTaskInputSchema,
  noteViewSchema,
  type AgentAuditEntry,
  type AgentAuditQuery,
  type AgentOperation,
  type AgentPermissionModule,
  type AgentProposalApproveInput,
  type AgentProposalBulkInput,
  type AgentProposalBulkResult,
  type AgentProposedResult,
  type ParsedCreateAgentTokenInput,
  type UpdateAgentTokenInput,
  type AgentEventCreate,
  type AgentFinanceDraftInput,
  type AgentFinanceRefs,
  type FinanceDraft,
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
  type AgentMode,
  type AgentScope,
  type AgentToken,
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
import { FinanceDraftsService } from "../finance/drafts/finance-drafts.service";
import { PluginsService } from "../plugins/plugins.service";
import { ModulesService } from "../modules/modules.service";
import { NotesService } from "../notes/notes.service";
import { ProjectsService } from "../projects/projects.service";
import { TasksService } from "../tasks/tasks.service";
import { RequirePermission } from "../common/require-permission";
import { AgentTokenGuard, type AgentRequest } from "./agent-token.guard";
import { AgentJobsService } from "./agent-jobs.service";
import { AgentTokensService, type AgentContext, type AuditMeta } from "./agent-tokens.service";
import { AgentUndoService } from "./agent-undo.service";

/** Token management for the signed-in member. The secret is returned once, by `POST`. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/agent-tokens")
export class AgentTokensController {
  constructor(
    private readonly tokens: AgentTokensService,
    private readonly jobs: AgentJobsService,
    private readonly undo: AgentUndoService
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentToken[]> {
    return this.tokens.list(user.userId, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createAgentTokenInputSchema)) body: ParsedCreateAgentTokenInput
  ): Promise<CreatedAgentToken> {
    return this.tokens.create(user.userId, workspaceId, body);
  }

  /** The panic button: every live token of the caller, at once. */
  @Post("revoke-all")
  async revokeAll(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<{ revoked: number }> {
    return { revoked: await this.tokens.revokeAll(user.userId, workspaceId) };
  }

  /** Filters: `tokenId`, `module`, `result` (ok|proposed|denied|limited|error), `from`/`to`, `limit`. */
  @Get("audit")
  audit(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(agentAuditQuerySchema)) query: AgentAuditQuery
  ): Promise<AgentAuditEntry[]> {
    return this.tokens.audit(user.userId, workspaceId, query);
  }

  /** "Отменить создание": a note an agent made goes to the trash, a task becomes canceled. Never a hard delete. */
  @Post("audit/:entryId/undo")
  undoCreation(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("entryId") entryId: string
  ): Promise<AgentAuditEntry> {
    return this.undo.undoCreation(user.userId, workspaceId, entryId);
  }

  @Get("proposals")
  proposals(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<AgentProposal[]> {
    return this.jobs.listProposals(user.userId, workspaceId);
  }

  @Post("proposals/bulk")
  bulk(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(agentProposalBulkInputSchema)) body: AgentProposalBulkInput
  ): Promise<AgentProposalBulkResult> {
    return this.jobs.decideMany(user.userId, workspaceId, body.ids, body.decision);
  }

  @Post("proposals/:proposalId/approve")
  approve(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("proposalId") proposalId: string,
    @Body(new ZodValidationPipe(agentProposalApproveInputSchema)) body: AgentProposalApproveInput
  ): Promise<AgentProposal> {
    return this.jobs.approve(user.userId, workspaceId, proposalId, body.force === true);
  }

  /** Re-check a stale request against the object as it is now: new preview, new basis, still pending. */
  @Post("proposals/:proposalId/refresh")
  refreshProposal(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("proposalId") proposalId: string
  ): Promise<AgentProposal> {
    return this.jobs.refresh(user.userId, workspaceId, proposalId);
  }

  @Post("proposals/:proposalId/reject")
  reject(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("proposalId") proposalId: string
  ): Promise<AgentProposal> {
    return this.jobs.reject(user.userId, workspaceId, proposalId);
  }

  @Patch(":tokenId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tokenId") tokenId: string,
    @Body(new ZodValidationPipe(updateAgentTokenInputSchema)) body: UpdateAgentTokenInput
  ): Promise<AgentToken> {
    return this.tokens.update(user.userId, workspaceId, tokenId, body);
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
    private readonly events: EventsService,
    private readonly financeDrafts: FinanceDraftsService,
    private readonly plugins: PluginsService
  ) {}

  @Get("me")
  me(@Req() req: AgentRequest): { tokenName: string; workspaceId: string; scopes: AgentScope[]; mode: AgentMode } {
    const agent = req.agent as AgentContext;
    return { tokenName: agent.tokenName, workspaceId: agent.workspaceId, scopes: agent.scopes, mode: agent.mode };
  }

  @Get("tasks")
  @RequirePermission("tasks.task.read")
  listTasks(@Req() req: AgentRequest, @Query("search") search?: string): Promise<Task[]> {
    return this.runOp(req, { perm: "tasks", op: "read", module: "tasks", action: "tasks.list" }, async (a: AgentContext) =>
      this.inFence(a, await this.tasks.list(a.userId, a.workspaceId, search))
    );
  }

  @Post("tasks")
  @RequirePermission("tasks.task.create")
  createTask(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createTaskInputSchema)) body: CreateTaskInput
  ): Promise<Task> {
    return this.runOp(
      req,
      { perm: "tasks", op: "create", module: "tasks", action: "tasks.create", fenceProject: this.fencedProject(body.projectId, body.projectTag) },
      (a) => this.tasks.create(a.userId, a.workspaceId, body, a.tokenName),
      { meta: (t) => ({ summary: `Создал задачу «${t.title}»`, objectType: "task", objectId: t.id }) }
    );
  }

  @Patch("tasks/:taskId")
  @RequirePermission("tasks.task.update")
  async updateTask(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: ReplyStatus,
    @Param("taskId") taskId: string,
    @Body(new ZodValidationPipe(agentTaskPatchSchema)) body: UpdateTaskInput
  ): Promise<Task | AgentProposedResult> {
    return this.reply(
      res,
      await this.runOp(
        req,
        { perm: "tasks", op: "update", module: "tasks", action: "tasks.update", resource: `task:${taskId}`, target: { kind: "task", id: taskId } },
        (a) => this.tasks.update(a.userId, a.workspaceId, taskId, body, a.tokenName),
        {
          meta: (t) => ({ summary: `Изменил задачу «${t.title}»: ${fieldList(body)}`, objectType: "task", objectId: t.id }),
          propose: (a: AgentContext) => this.jobs.propose(a, { action: "task.update", targetId: taskId, reason: "", patch: body as Record<string, unknown> })
        }
      )
    );
  }

  @Get("notes")
  listNotes(@Req() req: AgentRequest, @Query("search") search?: string): Promise<Note[]> {
    return this.runOp(req, { perm: "notes", op: "read", module: "notes", action: "notes.list" }, async (a: AgentContext) =>
      this.inFence(a, await this.notes.list(a.userId, a.workspaceId, search, noteViewSchema.parse("active")))
    );
  }

  @Get("notes/:noteId")
  getNote(@Req() req: AgentRequest, @Param("noteId") noteId: string): Promise<Note> {
    return this.runOp(req, { perm: "notes", op: "read", module: "notes", action: "notes.get", resource: `note:${noteId}` }, async (a: AgentContext) => {
      const note = await this.notes.getOne(a.userId, a.workspaceId, noteId);
      if (!this.tokens.projectAllowed(a, note.projectId)) throw new ForbiddenException("Заметка вне разрешённых проектов токена");
      return note;
    });
  }

  @Post("notes")
  createNote(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createNoteInputSchema)) body: CreateNoteInput
  ): Promise<Note> {
    return this.runOp(
      req,
      {
        perm: "notes",
        op: "create",
        module: "notes",
        action: "notes.create",
        fenceProject: this.fencedProject(body.projectId),
        decisionNote: isDecisionNote(body.tags) ? { projectId: body.projectId ?? null } : undefined
      },
      (a) => this.notes.create(a.userId, a.workspaceId, body, a.tokenName),
      { meta: (n) => ({ summary: `Создал заметку «${n.title}»`, objectType: "note", objectId: n.id }) }
    );
  }

  @Patch("notes/:noteId")
  async updateNote(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: ReplyStatus,
    @Param("noteId") noteId: string,
    @Body(new ZodValidationPipe(agentNotePatchSchema)) body: UpdateNoteInput
  ): Promise<Note | AgentProposedResult> {
    return this.reply(
      res,
      await this.runOp(
        req,
        { perm: "notes", op: "update", module: "notes", action: "notes.update", resource: `note:${noteId}`, target: { kind: "note", id: noteId } },
        (a) => this.notes.update(a.userId, a.workspaceId, noteId, body, a.tokenName),
        {
          meta: (n) => ({ summary: `Изменил заметку «${n.title}»: ${fieldList(body)}`, objectType: "note", objectId: n.id }),
          propose: (a: AgentContext) => this.jobs.propose(a, { action: "note.update", targetId: noteId, reason: "", patch: body as Record<string, unknown> })
        }
      )
    );
  }

  /** Window `[from, to)`; defaults to the next 30 days, at most 366 days wide. Recurring events come expanded. */
  @Get("events")
  listEvents(@Req() req: AgentRequest, @Query("from") from?: string, @Query("to") to?: string): Promise<Event[]> {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(start.getTime() + 30 * 24 * 3600 * 1000);
    return this.runOp(req, { perm: "events", op: "read", module: "calendar", action: "events.list" }, async (a: AgentContext) => {
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
        throw new BadRequestException("Некорректное окно запроса (from/to)");
      }
      if (end.getTime() - start.getTime() > 366 * 24 * 3600 * 1000) throw new BadRequestException("Окно не шире 366 дней");
      return this.inFence(a, await this.events.list(a.userId, a.workspaceId, start.toISOString(), end.toISOString()));
    });
  }

  @Post("events")
  createEvent(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(agentEventCreateSchema)) body: AgentEventCreate
  ): Promise<Event> {
    return this.runOp(
      req,
      { perm: "events", op: "create", module: "calendar", action: "events.create", fenceProject: this.fencedProject(body.projectId) },
      (a) => this.events.create(a.userId, a.workspaceId, body),
      { meta: (e) => ({ summary: `Создал событие «${e.title}»`, objectType: "event", objectId: e.id }) }
    );
  }

  @Patch("events/:eventId")
  async updateEvent(
    @Req() req: AgentRequest,
    @Res({ passthrough: true }) res: ReplyStatus,
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(agentEventPatchSchema)) body: AgentEventPatch
  ): Promise<Event | AgentProposedResult> {
    return this.reply(
      res,
      await this.runOp(
        req,
        {
          perm: "events",
          op: "update",
          module: "calendar",
          action: "events.update",
          resource: `event:${eventId}`,
          target: { kind: "event", id: eventId },
          fenceProject: body.projectId !== undefined ? { projectId: body.projectId } : undefined
        },
        (a) => this.events.update(a.userId, a.workspaceId, eventId, body, "all"),
        {
          meta: (e) => ({ summary: `Изменил событие «${e.title}»: ${fieldList(body)}`, objectType: "event", objectId: e.id }),
          propose: (a: AgentContext) => this.jobs.propose(a, { action: "event.update", targetId: eventId, reason: "", patch: body as Record<string, unknown> })
        }
      )
    );
  }

  /** Account and category names/ids, so a draft can name them. Nothing else about the finances is exposed. */
  @Get("finance/refs")
  financeRefs(@Req() req: AgentRequest): Promise<AgentFinanceRefs> {
    return this.runOp(req, { perm: "finance", op: "create", module: "finance", action: "finance.refs", readOnly: true }, async (a: AgentContext) => {
      await this.plugins.assertEnabled(a.userId, a.workspaceId, "finance-ai-drafts");
      return this.financeDrafts.refs(a.userId, a.workspaceId);
    });
  }

  /**
   * An agent that read a receipt PROPOSES an operation. It is a draft: no balance moves and no report changes until a
   * human reviews and confirms it in ORION. There is no endpoint here that writes an operation.
   */
  @Post("finance/drafts")
  proposeTransaction(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(agentFinanceDraftInputSchema)) body: AgentFinanceDraftInput
  ): Promise<FinanceDraft> {
    return this.runOp(
      req,
      { perm: "finance", op: "create", module: "finance", action: "finance.draft" },
      async (a) => {
        await this.plugins.assertEnabled(a.userId, a.workspaceId, "finance-ai-drafts");
        return this.financeDrafts.createFromAgent({ userId: a.userId, workspaceId: a.workspaceId, tokenId: a.tokenId, tokenName: a.tokenName }, body);
      },
      { meta: () => ({ summary: "Предложил операцию (черновик, подтверждает человек)" }) }
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

  /**
   * Deletion is never executed for an agent: it files a request a human approves in Settings. The same goes for a
   * change to an existing object when the token's mode is not allowed to apply it itself.
   */
  @Post("proposals")
  propose(
    @Req() req: AgentRequest,
    @Body(new ZodValidationPipe(createAgentProposalInputSchema)) body: CreateAgentProposalInput
  ): Promise<AgentProposal> {
    const kind = body.action.startsWith("task.") ? "task" : body.action.startsWith("note.") ? "note" : "event";
    const perm: AgentPermissionModule = kind === "task" ? "tasks" : kind === "note" ? "notes" : "events";
    return this.runOp(
      req,
      {
        perm,
        op: body.action.endsWith(".delete") ? "delete" : "propose",
        module: kind === "event" ? "calendar" : kind === "task" ? "tasks" : "notes",
        action: "proposals.create",
        resource: `${body.action}:${body.targetId}`,
        target: { kind, id: body.targetId },
        proposalEndpoint: true
      },
      (a) => this.jobs.propose(a, body),
      { meta: (p) => ({ summary: `Предложил: ${AGENT_PROPOSAL_ACTION_LABEL[p.action].toLowerCase()} «${p.targetTitle}»` }) }
    );
  }

  @Get("projects")
  listProjects(@Req() req: AgentRequest): Promise<Project[]> {
    return this.runOp(req, { perm: "projects", op: "read", module: "projects", action: "projects.list" }, async (a: AgentContext) => {
      const all = await this.projects.list(a.userId, a.workspaceId);
      return a.allowedProjectIds.length === 0 ? all : all.filter((p) => a.allowedProjectIds.includes(p.id));
    });
  }

  /** Only objects of the token's allowed projects (none = no fence). An object without a project is outside any fence. */
  private inFence<T extends { projectId: string | null }>(agent: AgentContext, items: T[]): T[] {
    return agent.allowedProjectIds.length === 0 ? items : items.filter((item) => this.tokens.projectAllowed(agent, item.projectId));
  }

  /** What a create is about, for the project fence: an explicit project, or a tag we cannot verify (→ rejected under a fence). */
  private fencedProject(projectId: string | null | undefined, projectTag?: string | null): { projectId: string | null; unverifiable?: boolean } {
    return { projectId: projectId ?? null, unverifiable: !projectId && Boolean(projectTag) };
  }

  /** A write that became a proposal is answered 202 with the proposal; anything else passes through. */
  private reply<T>(res: ReplyStatus, result: T | AgentProposedResult): T | AgentProposedResult {
    if (typeof result === "object" && result !== null && "proposed" in result && (result as AgentProposedResult).proposed === true) res.status(202);
    return result;
  }

  /**
   * One door for every module operation (TZ-03): policy (mode × matrix × "never" flags) → module on → project fence →
   * hourly write budget → run or file a proposal → journal, success or failure.
   */
  private runOp<T>(req: AgentRequest, spec: OpSpec, direct: (agent: AgentContext) => Promise<T>, options?: { meta?: (result: T) => AuditMeta }): Promise<T>;
  private runOp<T>(
    req: AgentRequest,
    spec: OpSpec,
    direct: (agent: AgentContext) => Promise<T>,
    options: { propose: (agent: AgentContext) => Promise<AgentProposal>; meta?: (result: T) => AuditMeta }
  ): Promise<T | AgentProposedResult>;
  private async runOp<T>(
    req: AgentRequest,
    spec: OpSpec,
    direct: (agent: AgentContext) => Promise<T>,
    options: { propose?: (agent: AgentContext) => Promise<AgentProposal>; meta?: (result: T) => AuditMeta } = {}
  ): Promise<T | AgentProposedResult> {
    const agent = req.agent as AgentContext;
    const base: AuditMeta = { module: spec.module };
    try {
      const decision = decideAgentOperation(agent, spec.perm, spec.op);
      if (decision.kind === "deny") throw new ForbiddenException(decision.reason);
      await this.modules.assertEnabled(agent.userId, agent.workspaceId, spec.module);
      if (spec.fenceProject && agent.allowedProjectIds.length > 0) {
        if (spec.fenceProject.unverifiable || !this.tokens.projectAllowed(agent, spec.fenceProject.projectId)) {
          throw new ForbiddenException("Проект вне разрешённых для токена: укажите projectId из списка");
        }
      }
      if (spec.target && agent.allowedProjectIds.length > 0) {
        const projectId = await this.tokens.targetProjectId(agent, spec.target.kind, spec.target.id);
        if (!this.tokens.projectAllowed(agent, projectId)) throw new ForbiddenException("Объект вне разрешённых проектов токена");
      }

      if (decision.kind === "propose") {
        if (spec.proposalEndpoint) {
          const proposal = (await direct(agent)) as unknown as AgentProposal;
          await this.tokens.record(agent, spec.action, spec.resource ?? null, 200, { ...base, ...options.meta?.(proposal as unknown as T) });
          return proposal as unknown as T;
        }
        if (!options.propose) throw new ForbiddenException("Для этого действия нужно подтверждение человека");
        const proposal = await options.propose(agent);
        await this.tokens.record(agent, spec.action, spec.resource ?? null, 202, {
          ...base,
          summary: `Предложил: ${AGENT_PROPOSAL_ACTION_LABEL[proposal.action].toLowerCase()} «${proposal.targetTitle}»`
        });
        return { proposed: true, proposal };
      }

      const writes = spec.op !== "read" && !spec.readOnly;
      if (writes) await this.tokens.assertWriteBudget(agent);
      if (spec.decisionNote && agent.mode === "manager" && !agent.autoCommitProjectIds.includes(spec.decisionNote.projectId ?? "")) {
        throw new ForbiddenException("Автофиксация решений выключена для этого проекта: включите её в настройках токена");
      }
      const result = await direct(agent);
      await this.tokens.record(agent, spec.action, spec.resource ?? null, 200, { ...base, ...options.meta?.(result), wrote: writes });
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      await this.tokens.record(agent, spec.action, spec.resource ?? null, status, base);
      throw error;
    }
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
      if (agent.mode === "observer" && !scope.endsWith(":read")) throw new ForbiddenException("Режим «наблюдатель»: запись запрещена");
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

/** The slice of an Express response the controller needs to answer 202. */
interface ReplyStatus {
  status(code: number): unknown;
}

interface OpSpec {
  perm: AgentPermissionModule;
  op: AgentOperation;
  module: OrionModuleId;
  action: string;
  resource?: string | null;
  /** The project a create/patch points at; checked against the token's project fence. */
  fenceProject?: { projectId: string | null; unverifiable?: boolean };
  /** An existing object the call changes; its project is looked up and fenced. */
  target?: { kind: "task" | "note" | "event"; id: string };
  /** An explicit decision note (tag «решение»): a manager token may save it without asking only in an auto-commit project. */
  decisionNote?: { projectId: string | null };
  /** Gated like a write but not counted against the hourly limit (e.g. reading finance refs). */
  readOnly?: boolean;
  /** `POST /proposals`: filing the request IS the operation, so it answers with the proposal itself. */
  proposalEndpoint?: boolean;
}

/** "статус, срок" — the fields a patch touches, in words. */
const FIELD_WORDS: Record<string, string> = {
  title: "название",
  description: "описание",
  status: "статус",
  priority: "приоритет",
  dueAt: "срок",
  summary: "краткое содержание",
  body: "текст",
  tags: "теги",
  location: "место",
  startAt: "начало",
  endAt: "конец",
  allDay: "весь день",
  reminders: "напоминания",
  projectId: "проект"
};
function fieldList(patch: object): string {
  const fields = Object.entries(patch)
    .filter(([key, value]) => key !== "expectedRevision" && value !== undefined)
    .map(([key]) => FIELD_WORDS[key] ?? key);
  return fields.length > 0 ? fields.join(", ") : "без изменений";
}
