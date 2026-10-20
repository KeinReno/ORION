import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  AGENT_API_VERSION,
  AGENT_CAPTURE_HINT_INFO,
  AGENT_CAPTURE_HINTS,
  AGENT_CONFIRMATION_RULES,
  AGENT_LIMITS,
  AGENT_MODE_HINT,
  AGENT_TOOLS,
  MODULE_CATALOG,
  agentAccessibleTypes,
  agentLinkableTypes,
  buildOrionLink,
  createEventInputSchema,
  createNoteInputSchema,
  createTaskInputSchema,
  resolveQuickCapture,
  type AgentCaptureInput,
  type AgentCaptureResult,
  type AgentCapability,
  type AgentEntityType,
  type AgentLinkEntityType,
  type AgentGatewayContext,
  type AgentLink,
  type AgentLinkInput,
  type AgentScope,
  type AgentSearchResponse,
  type OrionModuleId,
  type OrionLinkType,
  type RelationKind
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { EventsService } from "../events/events.service";
import { InboxService } from "../inbox/inbox.service";
import { ModulesService } from "../modules/modules.service";
import { NotesService } from "../notes/notes.service";
import { SearchService } from "../search/search.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { AgentContext } from "./agent-tokens.service";
import { resolveAiRateLimit } from "./rate-limiter";

type CaptureKind = "note" | "task" | "event" | "inbox";
type DbClient = Prisma.TransactionClient;

const WRITE_SCOPES: AgentScope[] = ["notes:write", "tasks:write", "events:write"];
/** The domain module each agent-reachable scope belongs to — decides which modules `context` may name. */
const SCOPE_MODULE: Partial<Record<AgentScope, OrionModuleId>> = {
  "tasks:read": "tasks",
  "tasks:write": "tasks",
  "notes:read": "notes",
  "notes:write": "notes",
  "projects:read": "projects",
  "events:read": "calendar",
  "events:write": "calendar",
  "finance:draft": "finance"
};
const TYPE_MODULE: Record<AgentEntityType, OrionModuleId> = { project: "projects", task: "tasks", note: "notes", event: "calendar" };
const CAPTURE_MODULE: Record<Exclude<CaptureKind, "inbox">, OrionModuleId> = { note: "notes", task: "tasks", event: "calendar" };
const EVENT_LENGTH_MS = 30 * 60_000;

/** What a `capture` call decided to do, before it touches the database. */
interface CapturePlan {
  kind: CaptureKind;
  /** An explicit `hint`: a switched-off or restricted module is an error (409/403), not a quiet detour. */
  strict?: boolean;
  /** Why the text goes to the Inbox rather than a note/task/event. */
  reason?: string;
  tags?: string[];
  /** From the quick-capture prefix (`#tag`), when no explicit project was given. */
  projectTag?: string | null;
  title?: string;
  /** The text without the quick-capture prefix, when a prefix was used. */
  text?: string;
}

/**
 * The Agent Gateway (TZ-02, ADR-0014): `context`, `capture`, `search` and `links` for an agent that has no source
 * code. Everything runs as the token's owner through the ordinary services, so membership, module switches and RLS
 * still decide; the scope checks here only narrow it further. No LLM, no guessing: a destination is either named
 * (`hint`, or an explicit `/task`·`/note`·`!` prefix) or the text waits in the Inbox for a person.
 */
@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService,
    private readonly notes: NotesService,
    private readonly events: EventsService,
    private readonly inbox: InboxService,
    private readonly search: SearchService
  ) {}

  // ── context ───────────────────────────────────────────────────────────────────────────────────
  async context(agent: AgentContext): Promise<AgentGatewayContext> {
    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const [workspace, member, token, accessible] = await Promise.all([
        tx.workspace.findUnique({ where: { id: agent.workspaceId }, select: { id: true, name: true } }),
        tx.workspaceMember.findFirst({ where: { workspaceId: agent.workspaceId, userId: agent.userId }, select: { role: true } }),
        tx.agentToken.findUnique({ where: { id: agent.tokenId }, select: { expiresAt: true } }),
        this.modules.accessibleSetTx(tx, agent.userId, agent.workspaceId)
      ]);
      if (!workspace) throw new NotFoundException("Пространство не найдено");

      const reachable = new Set<OrionModuleId>();
      for (const scope of agent.scopes) {
        const moduleId = SCOPE_MODULE[scope];
        if (moduleId && accessible.has(moduleId)) reachable.add(moduleId);
      }
      const types = agentAccessibleTypes(agent.scopes).filter((type) => accessible.has(TYPE_MODULE[type]));
      const canLink = agent.scopes.includes("links:write");
      const canSeeProjects = agent.scopes.includes("projects:read") && accessible.has("projects");
      const projectRows = canSeeProjects
        ? await tx.project.findMany({
            where: { workspaceId: agent.workspaceId, archivedAt: null },
            orderBy: { updatedAt: "desc" },
            take: AGENT_LIMITS.projects,
            select: { id: true, name: true }
          })
        : null;

      const moduleTools = AGENT_TOOLS.filter(
        (tool): tool is typeof tool & { permission: string; moduleId: string } =>
          !!tool.permission && !!tool.moduleId && agent.modulePermissions.includes(tool.permission) && accessible.has(tool.moduleId as OrionModuleId)
      ).map((tool) => ({ name: tool.name, moduleId: tool.moduleId, permission: tool.permission }));
      for (const moduleId of new Set(moduleTools.map((tool) => tool.moduleId))) reachable.add(moduleId as OrionModuleId);

      const hints = AGENT_CAPTURE_HINTS.map((hint) => {
        const info = AGENT_CAPTURE_HINT_INFO[hint];
        const available = agent.scopes.includes(info.scope) && accessible.has(CAPTURE_MODULE[info.creates]);
        return { hint, creates: info.creates, available, requires: info.scope, note: info.note };
      });
      const canCapture = WRITE_SCOPES.some((scope) => agent.scopes.includes(scope));
      const has = (...scopes: AgentScope[]): boolean => scopes.some((scope) => agent.scopes.includes(scope));
      const capabilities: AgentCapability[] = ["context", "manual"];
      if (canCapture) capabilities.push("capture");
      if (types.length > 0) capabilities.push("search");
      if (canLink && types.length > 1) capabilities.push("links");
      if (has("tasks:read", "tasks:write") && accessible.has("tasks")) capabilities.push("tasks");
      if (has("notes:read", "notes:write") && accessible.has("notes")) capabilities.push("notes");
      if (has("events:read", "events:write") && accessible.has("calendar")) capabilities.push("events");
      if (canSeeProjects) capabilities.push("projects");
      if (has("finance:draft") && accessible.has("finance")) capabilities.push("finance_drafts");
      if (has("agents:message")) capabilities.push("agent_messages");
      if (has("agents:delegate")) capabilities.push("agent_jobs");
      if (has("tasks:write", "notes:write")) capabilities.push("deletion_proposals");

      return {
        apiVersion: AGENT_API_VERSION,
        workspace: { id: workspace.id, name: workspace.name, role: member?.role ?? "member" },
        token: { name: agent.tokenName, scopes: agent.scopes, expiresAt: token?.expiresAt?.toISOString() ?? null, mode: agent.mode, modeNote: AGENT_MODE_HINT[agent.mode] },
        modules: MODULE_CATALOG.filter((module) => reachable.has(module.id)).map((module) => ({ id: module.id, label: module.label })),
        moduleTools,
        projects: projectRows?.map((project) => ({ id: project.id, name: project.name, url: buildOrionLink({ type: "project", id: project.id, workspaceId: agent.workspaceId }) })) ?? null,
        capture: { inbox: canCapture, hints },
        links: { types: canLink ? types : [], kinds: ["related_to", "supports"] },
        search: { types },
        limits: {
          callsPerMinute: resolveAiRateLimit(),
          textMaxLength: AGENT_LIMITS.textMaxLength,
          projects: AGENT_LIMITS.projects,
          linksPerCapture: AGENT_LIMITS.linksPerCapture
        },
        requiresConfirmation: AGENT_CONFIRMATION_RULES,
        capabilities,
        linkFormat: "orion://open?type=<project|task|note|event|inbox>&id=<id>&workspace=<workspaceId>"
      };
    });
  }

  // ── capture ───────────────────────────────────────────────────────────────────────────────────
  async capture(agent: AgentContext, input: AgentCaptureInput): Promise<AgentCaptureResult> {
    const label = attribution(agent.tokenName, input.source);
    const links = input.links ?? [];
    if (links.length > 0 && !agent.scopes.includes("links:write")) {
      throw new ForbiddenException("У токена нет разрешения «links:write» — связи при capture недоступны");
    }
    const linkableTypes = agentAccessibleTypes(agent.scopes);
    for (const ref of links) {
      if (!linkableTypes.includes(ref.type)) throw new ForbiddenException(`У токена нет доступа к объектам типа «${ref.type}»`);
    }
    if (!WRITE_SCOPES.some((scope) => agent.scopes.includes(scope))) {
      throw new ForbiddenException("У токена нет ни одного разрешения на запись (notes:write, tasks:write, events:write)");
    }

    return this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, agent.userId, agent.workspaceId);
      const plan = this.plan(agent, input, accessible);
      if (links.length > 0 && plan.kind === "inbox") {
        throw new BadRequestException("Связи нельзя привязать к записи во «Входящих»: укажите hint (idea/note/task/reminder/event) или уберите links");
      }
      if (plan.strict && plan.kind !== "inbox") {
        await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, CAPTURE_MODULE[plan.kind]);
      }
      await this.assertProjectTx(tx, agent, input.projectId ?? null);

      if (input.idempotencyKey) {
        const claimed = await tx.agentCapture.createMany({
          data: [{ workspaceId: agent.workspaceId, tokenId: agent.tokenId, idempotencyKey: input.idempotencyKey, kind: "pending", targetId: "" }],
          skipDuplicates: true
        });
        if (claimed.count === 0) return this.replay(tx, agent, input.idempotencyKey);
      }

      const created = await this.createTarget(tx, agent, plan, input, label);
      let linked = 0;
      for (const ref of links) {
        await this.search.createLinkTx(tx, agent.userId, agent.workspaceId, {
          sourceType: created.kind as AgentEntityType,
          sourceId: created.id,
          targetType: ref.type,
          targetId: ref.id,
          kind: ref.kind ?? "related_to",
          label: null
        });
        linked += 1;
      }
      if (input.idempotencyKey) {
        await tx.agentCapture.updateMany({
          where: { tokenId: agent.tokenId, idempotencyKey: input.idempotencyKey },
          data: { kind: created.kind, targetId: created.id }
        });
      }
      return {
        status: plan.kind === "inbox" ? "inbox" : "created",
        kind: created.kind,
        id: created.id,
        url: buildOrionLink({ type: created.kind as OrionLinkType, id: created.id, workspaceId: agent.workspaceId }),
        workspaceId: agent.workspaceId,
        projectId: input.projectId ?? null,
        deduplicated: false,
        ...(plan.reason ? { reason: plan.reason } : {}),
        linked
      };
    });
  }

  /** Decide the destination. An explicit hint is strict (403/409/400 on any obstacle); a prefix is soft (Inbox). */
  private plan(agent: AgentContext, input: AgentCaptureInput, accessible: Set<OrionModuleId>): CapturePlan {
    if (input.hint) {
      const info = AGENT_CAPTURE_HINT_INFO[input.hint];
      if (!agent.scopes.includes(info.scope)) throw new ForbiddenException(`У токена нет разрешения «${info.scope}»`);
      if (info.needsDueAt && !input.dueAt) {
        throw new BadRequestException(`Для hint «${input.hint}» нужен dueAt (ISO-8601). Если срок неизвестен, не указывайте hint — текст попадёт во «Входящие»`);
      }
      return { kind: info.creates, strict: true, tags: input.hint === "idea" ? ["идея"] : [] };
    }
    const canTask = agent.scopes.includes("tasks:write") && accessible.has("tasks");
    const canNote = agent.scopes.includes("notes:write") && accessible.has("notes");
    const quick = resolveQuickCapture(input.text.split("\n", 1)[0] ?? "", { tasks: canTask, notes: canNote });
    if (quick.kind === "task") return { kind: "task", title: quick.title, projectTag: quick.projectTag ?? null, text: stripFirstLine(input.text) };
    if (quick.kind === "note") return { kind: "note", title: quick.title, text: stripFirstLine(input.text) };
    return { kind: "inbox", reason: "Назначение не указано (hint) — запись ждёт разбора человеком" };
  }

  private async createTarget(
    tx: DbClient,
    agent: AgentContext,
    plan: CapturePlan,
    input: AgentCaptureInput,
    label: string
  ): Promise<{ kind: CaptureKind; id: string }> {
    const { userId, workspaceId } = agent;
    const projectId = input.projectId ?? null;
    const title = limit(input.title ?? plan.title ?? firstLine(input.text), 200);
    // The text as written, minus the first line when a quick-capture prefix (`/note …`) there decided the destination.
    const body = plan.text !== undefined ? plan.text : input.text;

    if (plan.kind === "inbox") {
      const row = await this.inbox.createFromAgentTx(tx, workspaceId, {
        title: limit(input.title ?? firstLine(input.text), 500),
        body: input.title || input.text.includes("\n") || input.text.length > 500 ? input.text : "",
        dueAt: input.dueAt ?? null,
        projectId,
        agentName: label
      });
      return { kind: "inbox", id: row.id };
    }

    if (plan.kind === "note") {
      const parsed = createNoteInputSchema.safeParse({ title, body: limit(body, AGENT_LIMITS.textMaxLength), tags: plan.tags ?? [], projectId });
      if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
      const note = await this.notes.createTx(tx, userId, workspaceId, parsed.data, label);
      return { kind: "note", id: note.id };
    }

    if (plan.kind === "task") {
      const description = input.title ? input.text : plan.text !== undefined ? plan.text : restAfterFirstLine(input.text, title);
      const parsed = createTaskInputSchema.safeParse({
        title,
        description: limit(description, AGENT_LIMITS.textMaxLength),
        dueAt: input.dueAt ?? null,
        projectId,
        ...(projectId ? {} : { projectTag: plan.projectTag ?? null })
      });
      if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
      const task = await this.tasks.createTx(tx, userId, workspaceId, parsed.data);
      await tx.taskActivity.create({ data: { workspaceId, taskId: task.id, actorId: userId, field: "created", toValue: task.title, agentName: label } });
      return { kind: "task", id: task.id };
    }

    const start = new Date(input.dueAt as string);
    const parsed = createEventInputSchema.safeParse({
      title,
      description: limit(input.title ? input.text : restAfterFirstLine(input.text, title), AGENT_LIMITS.textMaxLength),
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + EVENT_LENGTH_MS).toISOString(),
      projectId
    });
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
    const event = await this.events.createTx(tx, workspaceId, parsed.data);
    return { kind: "event", id: event.id };
  }

  /** The same key again: hand back what the first call made. The record may have been deleted since — the answer stays. */
  private async replay(tx: DbClient, agent: AgentContext, key: string): Promise<AgentCaptureResult> {
    const first = await tx.agentCapture.findUnique({ where: { tokenId_idempotencyKey: { tokenId: agent.tokenId, idempotencyKey: key } } });
    if (!first || first.kind === "pending") throw new BadRequestException("Запрос с этим idempotencyKey ещё выполняется — повторите позже");
    const kind = first.kind as CaptureKind;
    return {
      status: kind === "inbox" ? "inbox" : "created",
      kind,
      id: first.targetId,
      url: buildOrionLink({ type: kind as OrionLinkType, id: first.targetId, workspaceId: agent.workspaceId }),
      workspaceId: agent.workspaceId,
      projectId: await projectOf(tx, kind, first.targetId),
      deduplicated: true,
      linked: 0
    };
  }

  private async assertProjectTx(tx: DbClient, agent: AgentContext, projectId: string | null): Promise<void> {
    if (!projectId) return;
    await this.modules.assertEnabledTx(tx, agent.userId, agent.workspaceId, "projects");
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { workspaceId: true } });
    if (!project || project.workspaceId !== agent.workspaceId) throw new BadRequestException("Проект не найден в этом пространстве");
  }

  // ── search ────────────────────────────────────────────────────────────────────────────────────
  async searchObjects(agent: AgentContext, query: string): Promise<AgentSearchResponse> {
    const types = agentAccessibleTypes(agent.scopes);
    if (types.length === 0) throw new ForbiddenException("У токена нет разрешений на чтение (projects:read, tasks:read, notes:read, events:read)");
    const hits = await this.search.search(agent.userId, agent.workspaceId, query, types);
    const results = hits
      .filter((hit): hit is typeof hit & { type: AgentEntityType } => (types as string[]).includes(hit.type))
      .map((hit) => ({
        type: hit.type,
        id: hit.id,
        title: hit.title,
        url: buildOrionLink({ type: hit.type, id: hit.id, workspaceId: agent.workspaceId }),
        snippet: hit.matchedText
      }));
    return { results, searched: types };
  }

  // ── links ─────────────────────────────────────────────────────────────────────────────────────
  async link(agent: AgentContext, input: AgentLinkInput): Promise<AgentLink> {
    const allowed: string[] = agentLinkableTypes(agent.scopes, agent.modulePermissions);
    for (const type of [input.sourceType, input.targetType]) {
      if (!allowed.includes(type)) throw new ForbiddenException(`У токена нет доступа к объектам типа «${type}»`);
    }
    // Both endpoints are checked against this workspace (404 otherwise) and its module switches (403) by the link service.
    const link = await this.search.createLink(agent.userId, agent.workspaceId, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      targetType: input.targetType,
      targetId: input.targetId,
      kind: input.kind,
      label: null
    });
    return toAgentLink(link, agent.workspaceId);
  }

  async unlink(agent: AgentContext, linkId: string): Promise<void> {
    const allowed: string[] = agentLinkableTypes(agent.scopes, agent.modulePermissions);
    const row = await this.prisma.withUser(agent.userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, agent.userId, agent.workspaceId);
      return tx.entityLink.findUnique({ where: { id: linkId }, select: { workspaceId: true, sourceType: true, targetType: true } });
    });
    if (!row || row.workspaceId !== agent.workspaceId) throw new NotFoundException("Связь не найдена");
    // A link whose end the token cannot see is not the token's to touch — and its existence is not confirmed.
    if (!allowed.includes(row.sourceType) || !allowed.includes(row.targetType)) {
      throw new NotFoundException("Связь не найдена");
    }
    await this.search.removeLink(agent.userId, agent.workspaceId, linkId);
  }
}

function toAgentLink(
  link: { id: string; sourceType: string; sourceId: string; targetType: string; targetId: string; kind: RelationKind },
  workspaceId: string
): AgentLink {
  return {
    id: link.id,
    sourceType: link.sourceType as AgentLinkEntityType,
    sourceId: link.sourceId,
    targetType: link.targetType as AgentLinkEntityType,
    targetId: link.targetId,
    kind: link.kind,
    sourceUrl: buildOrionLink({ type: link.sourceType as AgentLinkEntityType, id: link.sourceId, workspaceId }),
    targetUrl: buildOrionLink({ type: link.targetType as AgentLinkEntityType, id: link.targetId, workspaceId })
  };
}

/** `Claude` or `Claude (чат про ремонт)` — what a person sees next to 🤖. */
function attribution(tokenName: string, source: string | undefined): string {
  return limit(source ? `${tokenName} (${source})` : tokenName, 160);
}

function limit(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function firstLine(text: string): string {
  const line = text.split("\n").find((part) => part.trim().length > 0) ?? text;
  return limit(line.trim().replace(/^#+\s*/, ""), 200) || "Без названия";
}

function stripFirstLine(text: string): string {
  const index = text.indexOf("\n");
  return index < 0 ? "" : text.slice(index + 1).trim();
}

/** Everything after the line that became the title; the whole text when the title was cut from a longer line. */
function restAfterFirstLine(text: string, title: string): string {
  const first = text.split("\n", 1)[0]?.trim().replace(/^#+\s*/, "") ?? "";
  return first === title ? stripFirstLine(text) : text;
}

async function projectOf(tx: DbClient, kind: CaptureKind, id: string): Promise<string | null> {
  const select = { projectId: true } as const;
  const where = { id } as const;
  const row =
    kind === "note" ? await tx.note.findUnique({ where, select }) :
    kind === "task" ? await tx.task.findUnique({ where, select }) :
    kind === "event" ? await tx.event.findUnique({ where, select }) :
    await tx.inboxItem.findUnique({ where, select });
  return row?.projectId ?? null;
}

