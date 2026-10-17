import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityManagerAction as ActionRow, OpportunityPolicy as PolicyRow, Prisma } from "@prisma/client";
import {
  MANAGER_LIMITS, managerActionSchema, policyReportSchema, policySchema, tickResultSchema,
  type CreatePolicyInput, type ManagerAction, type ManagerActionState, type Opportunity, type Policy, type PolicyActionInput, type PolicyReport, type TickResult
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { CapabilityLifecycle } from "../common/capability-lifecycle";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ASSISTANT_AUTOMATION_PORT, type AssistantAutomationPort } from "../opportunities-assistant/public";
import { EXECUTION_AUTOMATION_PORT, ExecutionAuthorityRegistry, type ExecutionAutomationPort } from "../opportunities-execution/public";
import { OPPORTUNITIES_READ_PORT, type OpportunitiesReadPort } from "../opportunities/public";
import { PROFILE_EVIDENCE_PORT, type ProfileEvidencePort } from "../opportunities-profiles/public";
import { evaluateGates, inQuietHours } from "./manager-core";

type Tx = Prisma.TransactionClient;
const PLUGIN = "opportunities-manager" as const;
const PAGE = 50;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const refOf = (policyId: string) => `policy:${policyId}`;

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function policyDto(row: PolicyRow): Policy {
  return policySchema.parse({
    id: row.id, workspaceId: row.workspaceId, connectionId: row.connectionId, profileId: row.profileId, state: row.state, pausedReason: row.pausedReason, minScore: row.minScore, minConfidence: row.minConfidence,
    requiredFactIds: row.requiredFactIds, dailyLimit: row.dailyLimit, maxTotal: row.maxTotal, remaining: row.remaining,
    quietHours: row.quietStart && row.quietEnd ? { start: row.quietStart, end: row.quietEnd } : null, timezone: row.timezone, expiresAt: row.expiresAt.toISOString(), revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString()
  });
}

type ItemOutcome = { stop: string } | { action: ActionRow };

/**
 * ИИ-менеджер: ограниченная автономность по явной политике. Выполняется ТОЛЬКО по команде владельца («Запустить цикл»);
 * фонового планировщика нет. Каждый кандидат обрабатывается отдельной транзакцией: сбой одного не портит остальные,
 * а повторный запуск и параллельные циклы не создают второго действия по той же возможности (уникальный ключ в БД).
 */
@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService,
    @Inject(ASSISTANT_AUTOMATION_PORT) private readonly assistant: AssistantAutomationPort,
    @Inject(EXECUTION_AUTOMATION_PORT) private readonly execution: ExecutionAutomationPort,
    @Inject(OPPORTUNITIES_READ_PORT) private readonly opportunities: OpportunitiesReadPort,
    @Inject(PROFILE_EVIDENCE_PORT) private readonly profiles: ProfileEvidencePort,
    private readonly authorities: ExecutionAuthorityRegistry,
    private readonly lifecycle: CapabilityLifecycle
  ) {}

  onModuleInit(): void {
    this.lifecycle.register("opportunities-manager", async (tx, change) => {
      if (change.enabled || change.kind !== "plugin" || change.id !== "opportunities-manager") return;
      await tx.$queryRaw`SELECT id FROM opportunity_policies WHERE "workspaceId" = ${change.workspaceId} AND state IN ('active', 'paused') ORDER BY id FOR UPDATE`;
      const policies = await tx.opportunityPolicy.findMany({ where: { workspaceId: change.workspaceId, state: { in: ["active", "paused"] } } });
      for (const policy of policies) {
        await tx.opportunityPolicy.update({ where: { id: policy.id }, data: { state: "paused", pausedReason: "Менеджер выключен — требуется явное возобновление", revision: { increment: 1 } } });
        await this.execution.cancelByPolicyTx(tx, change.workspaceId, refOf(policy.id), "Менеджер выключен. Разрешение отозвано.");
      }
    });
    this.authorities.register("policy", async (tx, context) => {
      await this.guard(tx, context.ownerUserId, context.workspaceId);
      const policy = await this.loadPolicy(tx, context.workspaceId, context.reference.slice("policy:".length));
      if (policy.ownerUserId !== context.ownerUserId || policy.connectionId !== context.connectionId || policy.profileId !== context.profileId) return "policy_scope_mismatch";
      if (policy.state !== "active" || policy.expiresAt <= new Date()) return "policy_inactive";
      if (inQuietHours(new Date(), policy.timezone, policy.quietStart, policy.quietEnd)) return "policy_quiet_hours";
      const uncertain = await tx.opportunityAttempt.count({ where: { workspaceId: context.workspaceId, initiatedBy: context.reference, state: "sent_unconfirmed" } });
      return uncertain ? "policy_uncertain_send" : null;
    });
  }

  private async guard(tx: Tx, user: string, ws: string) {
    await this.workspaces.assertMemberRoleTx(tx, user, ws, ["owner"]);
    await this.plugins.assertEnabledTx(tx, user, ws, PLUGIN);
  }

  private async loadPolicy(tx: Tx, ws: string, id: string): Promise<PolicyRow> {
    const row = await tx.opportunityPolicy.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Политика не найдена");
    return row;
  }

  /** Срок действия: истёкшая политика отменяет свою ещё не начатую работу и больше не возобновляется. */
  private async refreshTx(tx: Tx, ws: string, policy: PolicyRow): Promise<PolicyRow> {
    if ((policy.state === "active" || policy.state === "paused") && policy.expiresAt <= new Date()) {
      await tx.opportunityPolicy.updateMany({ where: { id: policy.id, state: policy.state }, data: { state: "expired", pausedReason: "Срок политики истёк", revision: { increment: 1 } } });
      await this.execution.cancelByPolicyTx(tx, ws, refOf(policy.id), "Срок политики истёк.");
      return this.loadPolicy(tx, ws, policy.id);
    }
    return policy;
  }

  /* ---------------- Политики ---------------- */

  async createPolicy(user: string, ws: string, input: CreatePolicyInput): Promise<Policy> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const connection = await tx.opportunityConnection.findFirst({ where: { id: input.connectionId, workspaceId: ws } });
      if (!connection) throw new NotFoundException("Подключение не найдено");
      if (connection.state !== "linked") throw new ConflictException("Подключение должно быть активным: сначала свяжите аккаунт с локальным исполнителем.");
      if (input.dailyLimit > connection.dailyLimit) throw new BadRequestException(`Дневной лимит политики не может превышать лимит подключения (${connection.dailyLimit}).`);
      const evidence = await this.profiles.readEvidenceTx(tx, user, ws, connection.profileId);
      if (evidence.profile.archivedAt) throw new ConflictException("Профиль в архиве.");
      const confirmed = new Set(evidence.facts.filter((f) => f.state === "confirmed").map((f) => f.id));
      if (input.requiredFactIds.some((id) => !confirmed.has(id))) throw new BadRequestException("Требуемые факты должны быть подтверждёнными фактами этого профиля.");
      try {
        const row = await tx.opportunityPolicy.create({ data: {
          workspaceId: ws, connectionId: connection.id, profileId: connection.profileId, ownerUserId: user, minScore: input.minScore, minConfidence: input.minConfidence, requiredFactIds: input.requiredFactIds,
          dailyLimit: input.dailyLimit, maxTotal: input.maxTotal, remaining: input.maxTotal, quietStart: input.quietHours?.start ?? null, quietEnd: input.quietHours?.end ?? null, timezone: connection.timezone,
          expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000)
        } });
        return policyDto(row);
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") throw new ConflictException("У этого подключения уже есть действующая или приостановленная политика. Остановите её, чтобы создать новую.");
        throw error;
      }
    });
  }

  async listPolicies(user: string, ws: string): Promise<Policy[]> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const rows = await tx.opportunityPolicy.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 30 });
      const out: Policy[] = [];
      for (const row of rows) out.push(policyDto(await this.refreshTx(tx, ws, row)));
      return out;
    });
  }

  private async change(user: string, ws: string, id: string, input: PolicyActionInput, kind: "pause" | "resume" | "stop"): Promise<Policy> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      await tx.$queryRaw`SELECT id FROM opportunity_policies WHERE id = ${id} AND "workspaceId" = ${ws} FOR UPDATE`;
      const policy = await this.refreshTx(tx, ws, await this.loadPolicy(tx, ws, id));
      if (policy.revision !== input.expectedRevision) throw new ConflictException("Политика изменена в другом окне. Обновите данные.");
      if (policy.state === "stopped" || policy.state === "expired") throw new ConflictException(policy.state === "expired" ? "Срок политики истёк. Создайте новую." : "Политика остановлена. Создайте новую.");
      const data: Prisma.OpportunityPolicyUpdateManyMutationInput = { revision: { increment: 1 } };
      if (kind === "resume") {
        if (policy.state !== "paused") throw new ConflictException("Политика не приостановлена.");
        if (policy.remaining <= 0) throw new ConflictException("Лимит действий политики исчерпан. Создайте новую.");
        const connection = await tx.opportunityConnection.findFirst({ where: { id: policy.connectionId, workspaceId: ws } });
        if (connection?.state !== "linked") throw new ConflictException("Подключение не активно.");
        const stats = await this.execution.statsByPolicyTx(tx, ws, refOf(id));
        if (stats.sent_unconfirmed) throw new ConflictException("Есть отправка без подтверждения. Сверьте её результат на вкладке «Отправка», затем возобновите политику.");
        data.state = "active"; data.pausedReason = null;
      } else {
        data.state = kind === "stop" ? "stopped" : "paused";
        data.pausedReason = input.reason ?? (kind === "stop" ? "Остановлено владельцем" : "Приостановлено владельцем");
      }
      const changed = await tx.opportunityPolicy.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data });
      if (!changed.count) throw new ConflictException("Политика изменена в другом окне. Обновите данные.");
      if (kind !== "resume") await this.execution.cancelByPolicyTx(tx, ws, refOf(id), kind === "stop" ? "Политика остановлена." : "Политика приостановлена.");
      return policyDto(await this.loadPolicy(tx, ws, id));
    });
  }
  pause(user: string, ws: string, id: string, input: PolicyActionInput) { return this.change(user, ws, id, input, "pause"); }
  resume(user: string, ws: string, id: string, input: PolicyActionInput) { return this.change(user, ws, id, input, "resume"); }
  stop(user: string, ws: string, id: string, input: PolicyActionInput) { return this.change(user, ws, id, input, "stop"); }

  /* ---------------- Отчёт ---------------- */

  private async actionDtos(tx: Tx, user: string, ws: string, rows: ActionRow[]): Promise<ManagerAction[]> {
    const titles = new Map<string, string>();
    const out: ManagerAction[] = [];
    for (const row of rows) {
      if (!titles.has(row.opportunityId)) titles.set(row.opportunityId, await this.opportunities.readTx(tx, user, ws, row.opportunityId).then((o) => o.title).catch(() => "Карточка недоступна"));
      out.push(managerActionSchema.parse({ id: row.id, policyId: row.policyId, opportunityId: row.opportunityId, opportunityTitle: titles.get(row.opportunityId), state: row.state, reason: row.reason, details: row.details, attemptId: row.attemptId, policyRevision: row.policyRevision, createdAt: row.createdAt.toISOString() }));
    }
    return out;
  }

  async report(user: string, ws: string, id: string, cursor?: string): Promise<PolicyReport> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const policy = await this.refreshTx(tx, ws, await this.loadPolicy(tx, ws, id));
      if (cursor && !await tx.opportunityManagerAction.findFirst({ where: { id: cursor, policyId: id, workspaceId: ws } })) throw new NotFoundException("Запись журнала не найдена");
      const rows = await tx.opportunityManagerAction.findMany({ where: { policyId: id, workspaceId: ws }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      const grouped = await tx.opportunityManagerAction.groupBy({ by: ["state"], where: { policyId: id, workspaceId: ws }, _count: { _all: true } });
      const count = (state: string) => grouped.find((g) => g.state === state)?._count._all ?? 0;
      const budget = await tx.opportunityBudget.findUnique({ where: { workspaceId_accountKey_actionType_localDate: { workspaceId: ws, accountKey: refOf(id), actionType: "manager_queue", localDate: localDate(new Date(), policy.timezone) } } });
      return policyReportSchema.parse({
        policy: policyDto(policy), today: { queued: budget?.used ?? 0, limit: policy.dailyLimit },
        totals: { queued: count("queued"), skipped: count("skipped"), needsReview: count("needs_review"), failed: count("failed") },
        attemptsByState: await this.execution.statsByPolicyTx(tx, ws, refOf(id)),
        actions: await this.actionDtos(tx, user, ws, rows.slice(0, PAGE)), nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null
      });
    });
  }

  /* ---------------- Цикл менеджера ---------------- */

  async tick(user: string, ws: string, id: string): Promise<TickResult> {
    const prep = await this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const policy = await this.refreshTx(tx, ws, await this.loadPolicy(tx, ws, id));
      const stop = await this.preflightTx(tx, ws, policy);
      if (stop) return { stop, candidates: [] as Opportunity[] };
      const done = new Set((await tx.opportunityManagerAction.findMany({ where: { policyId: id, workspaceId: ws }, select: { opportunityId: true } })).map((a) => a.opportunityId));
      const candidates: Opportunity[] = []; let afterId: string | undefined;
      // A completed first page must not starve every later card forever.
      for (;;) {
        const page = await this.opportunities.listCandidatesTx(tx, user, ws, { sourceType: "hh", statuses: ["new"], limit: 200, afterId });
        candidates.push(...page.filter((o) => !done.has(o.id)).slice(0, MANAGER_LIMITS.tickBatch - candidates.length));
        if (candidates.length >= MANAGER_LIMITS.tickBatch || page.length < 200) break;
        afterId = page[page.length - 1].id;
      }
      return { stop: null as string | null, candidates };
    });
    const actions: ActionRow[] = []; let stoppedReason = prep.stop;
    if (!prep.stop) {
      for (const opportunity of prep.candidates) {
        const outcome = await this.processItem(user, ws, id, opportunity);
        if ("stop" in outcome) { stoppedReason = outcome.stop; break; }
        actions.push(outcome.action);
      }
    }
    const count = (state: ManagerActionState) => actions.filter((a) => a.state === state).length;
    const dtos = await this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return this.actionDtos(tx, user, ws, actions); });
    return tickResultSchema.parse({ processed: actions.length, queued: count("queued"), skipped: count("skipped"), needsReview: count("needs_review"), failed: count("failed"), stoppedReason, actions: dtos });
  }

  /** Причины, по которым цикл не должен работать вообще. Может приостановить политику (неопределённая отправка). */
  private async preflightTx(tx: Tx, ws: string, policy: PolicyRow): Promise<string | null> {
    if (policy.state !== "active") return `Политика не действует: ${policy.state === "paused" ? (policy.pausedReason ?? "приостановлена") : policy.state === "expired" ? "срок истёк" : "остановлена"}.`;
    if (policy.remaining <= 0) return "Лимит действий политики исчерпан.";
    const connection = await tx.opportunityConnection.findFirst({ where: { id: policy.connectionId, workspaceId: ws } });
    if (connection?.state !== "linked") return "Подключение аккаунта не активно.";
    if (inQuietHours(new Date(), policy.timezone, policy.quietStart, policy.quietEnd)) return `Тихие часы (${policy.quietStart}–${policy.quietEnd}): менеджер ничего не ставит в очередь.`;
    const stats = await this.execution.statsByPolicyTx(tx, ws, refOf(policy.id));
    if (stats.sent_unconfirmed) {
      await tx.opportunityPolicy.updateMany({ where: { id: policy.id, state: "active" }, data: { state: "paused", pausedReason: "Есть отправка без подтверждения — сверьте результат", revision: { increment: 1 } } });
      return "Политика приостановлена: есть отправка без подтверждения. Сверьте её результат.";
    }
    return null;
  }

  private async processItem(user: string, ws: string, policyId: string, opportunity: Opportunity): Promise<ItemOutcome> {
    try {
      return await this.prisma.withUser(user, async (tx): Promise<ItemOutcome> => {
        await this.guard(tx, user, ws);
        await tx.$queryRaw`SELECT id FROM opportunity_policies WHERE id = ${policyId} AND "workspaceId" = ${ws} FOR UPDATE`;
        const policy = await this.refreshTx(tx, ws, await this.loadPolicy(tx, ws, policyId));
        const stop = await this.preflightTx(tx, ws, policy);
        if (stop) return { stop };
        const record = async (state: ManagerActionState, reason: string, details: string[], attemptId: string | null = null) =>
          ({ action: await tx.opportunityManagerAction.create({ data: { workspaceId: ws, policyId, opportunityId: opportunity.id, state, reason, details: json(details.slice(0, 12)), attemptId, policyRevision: policy.revision } }) });

        const assessment = await this.assistant.assessTx(tx, user, ws, opportunity.id, policy.profileId);
        const evidence = await this.profiles.readEvidenceTx(tx, user, ws, policy.profileId);
        const verdict = evaluateGates({ assessment, minScore: policy.minScore, minConfidence: policy.minConfidence as "medium" | "high", requiredFactIds: policy.requiredFactIds as string[], confirmedFactIds: new Set(evidence.facts.filter((f) => f.state === "confirmed").map((f) => f.id)) });
        if (verdict.decision === "skip") return record("skipped", "Не прошла пороги политики.", verdict.reasons);
        if (verdict.decision === "review") return record("needs_review", "Нужно решение человека: есть непроверенные сведения.", verdict.reasons);

        // Дневной лимит менеджера — атомарно в БД (INSERT … ON CONFLICT … WHERE used < limit). Если упёрлись — цикл останавливается, возможность не помечается обработанной.
        const date = localDate(new Date(), policy.timezone);
        const taken = await tx.$queryRaw<{ used: number }[]>`INSERT INTO opportunity_budgets (id, "workspaceId", "accountKey", "actionType", "localDate", used, "updatedAt") VALUES (gen_random_uuid()::text, ${ws}, ${refOf(policyId)}, 'manager_queue', ${date}, 1, now()) ON CONFLICT ("workspaceId", "accountKey", "actionType", "localDate") DO UPDATE SET used = opportunity_budgets.used + 1, "updatedAt" = now() WHERE opportunity_budgets.used < ${policy.dailyLimit} RETURNING used`;
        if (!taken.length) throw new StopTick(`Дневной лимит менеджера исчерпан (${policy.dailyLimit}).`);

        const draft = await this.assistant.createResponseDraftTx(tx, user, ws, opportunity.id, policy.profileId, opportunity.kind === "contract" ? "proposal" : "response");
        const approved = await this.assistant.approveForPolicyTx(tx, user, ws, draft.id, refOf(policyId));
        const left = await tx.$executeRaw`UPDATE opportunity_policies SET remaining = remaining - 1, "updatedAt" = now() WHERE id = ${policyId} AND "workspaceId" = ${ws} AND remaining > 0 AND state = 'active'`;
        if (!left) throw new StopTick("Лимит действий политики исчерпан.");
        const attempt = await this.execution.queueByPolicyTx(tx, user, ws, { connectionId: policy.connectionId, draftId: approved.id, policyRef: refOf(policyId), idempotencyKey: `mgr:${policyId}:${opportunity.id}`.slice(0, 80), ttlMinutes: MANAGER_LIMITS.grantMinutes });
        return record("queued", "Поставлено в очередь отправки по политике.", [`Рейтинг ${assessment.score}, надёжность ${assessment.confidence}`], attempt.id);
      });
    } catch (error) {
      if (error instanceof StopTick) return { stop: error.message };
      return this.recordFailure(user, ws, policyId, opportunity, error);
    }
  }

  /** Транзакция элемента откатилась целиком (в том числе лимиты и черновик) — записываем причину отдельной короткой транзакцией. */
  private async recordFailure(user: string, ws: string, policyId: string, opportunity: Opportunity, error: unknown): Promise<ItemOutcome> {
    let state: ManagerActionState = "failed"; let reason = "Внутренняя ошибка при обработке.";
    let details: string[] = [];
    if (error instanceof HttpException) {
      const status = error.getStatus(); const body = error.getResponse() as { message?: string | string[]; blockers?: string[]; reviewNotes?: string[] } | string;
      const message = typeof body === "string" ? body : Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? error.message);
      details = typeof body === "string" ? [] : [...(body.blockers ?? []), ...(body.reviewNotes ?? [])];
      if (status === 409 || status === 400 || status === 404) { state = /уже есть|активная или завершённая/i.test(message) ? "skipped" : "needs_review"; reason = message; }
      else if (status === 403) return { stop: "Права владельца отозваны — цикл остановлен." };
    }
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const policy = await this.loadPolicy(tx, ws, policyId);
      const created = await tx.opportunityManagerAction.createMany({ skipDuplicates: true, data: [{ workspaceId: ws, policyId, opportunityId: opportunity.id, state, reason: reason.slice(0, 500), details: json(details.slice(0, 12)), policyRevision: policy.revision }] });
      const action = await tx.opportunityManagerAction.findFirstOrThrow({ where: { policyId, opportunityId: opportunity.id, workspaceId: ws } });
      void created;
      return { action };
    });
  }
}

class StopTick extends Error {}
