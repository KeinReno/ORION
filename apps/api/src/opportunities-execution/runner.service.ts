import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { OpportunityAttempt as AttemptRow, OpportunityConnection as ConnectionRow, Prisma } from "@prisma/client";
import {
  EXECUTION_LIMITS, EXECUTOR_CONTRACT_VERSION, attemptPayloadSchema,
  type Evidence, type RunnerBindInput, type RunnerBindResult, type RunnerClaimResult, type RunnerHeartbeatResult, type RunnerLeaseInput, type RunnerReserveInput, type RunnerReserveResult, type RunnerResult, type RunnerResultInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { appendTimeline, decideOutcome, localDateKey, newSecret, secondsToLocalMidnight, sha256 } from "./exec-core";
import { ExecutionService } from "./execution.service";
import { ExecutionAuthorityRegistry } from "./authority-registry";

type Tx = Prisma.TransactionClient;
const PLUGIN = "opportunities-execution" as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export interface RunnerPrincipal { connectionId: string; workspaceId: string; ownerUserId: string }

/**
 * Серверная сторона протокола `opportunities-executor/v1`. Исполнитель аутентифицируется ТОЛЬКО capability-токеном
 * подключения (не пользовательским JWT) и действует с правами владельца подключения: каждый вызов заново проверяет, что
 * владелец остаётся владельцем пространства, плагин включён, подключение активно, разрешение и содержимое действительны.
 * Исполнитель не получает ни cookies, ни произвольных команд: только фиксированные действия над одной попыткой.
 */
@Injectable()
export class RunnerService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService, private readonly execution: ExecutionService, private readonly authorities: ExecutionAuthorityRegistry) {}

  /* ---------- Привязка и аутентификация ---------- */

  /** Одноразовый код сопряжения → токен исполнителя (показывается один раз) и привязка к аккаунту, который назвал сам исполнитель. */
  async bind(input: RunnerBindInput): Promise<RunnerBindResult> {
    const token = newSecret("ohr");
    const now = new Date();
    return this.prisma.asSystem(async (tx) => {
      const row = await tx.opportunityConnection.findFirst({ where: { pairingHash: sha256(input.pairingCode) } });
      if (!row || row.state !== "pending_link" || !row.pairingExpiresAt || row.pairingExpiresAt <= now) throw new UnauthorizedException("Код сопряжения недействителен или истёк. Создайте подключение заново.");
      const changed = await tx.opportunityConnection.updateMany({ where: { id: row.id, pairingHash: row.pairingHash, state: "pending_link" }, data: {
        state: "linked", externalAccountId: input.externalAccountId, accountDisplay: input.accountDisplay, runnerId: input.runnerId, runnerTokenHash: token.hash,
        pairingHash: null, pairingExpiresAt: null, linkedAt: now, runnerSeenAt: now, consecutiveFailures: 0, revision: { increment: 1 }
      } });
      if (!changed.count) throw new UnauthorizedException("Код сопряжения уже использован.");
      return { connectionId: row.id, runnerToken: token.secret, contractVersion: EXECUTOR_CONTRACT_VERSION };
    });
  }

  async authenticate(token: string | null): Promise<RunnerPrincipal> {
    if (!token || !/^ohr_[a-f0-9]{48}$/.test(token)) throw new UnauthorizedException("Нет токена исполнителя");
    const row = await this.prisma.asSystem((tx) => tx.opportunityConnection.findFirst({ where: { runnerTokenHash: sha256(token) } }));
    if (!row || row.state === "revoked" || row.state === "pending_link") throw new UnauthorizedException("Токен исполнителя недействителен");
    return { connectionId: row.id, workspaceId: row.workspaceId, ownerUserId: row.ownerUserId };
  }

  /** Все операции — в транзакции с правами владельца подключения; при отозванных правах подключение ставится на паузу. */
  private async asOwner<T>(p: RunnerPrincipal, work: (tx: Tx, connection: ConnectionRow) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.withUser(p.ownerUserId, async (tx) => {
        await this.workspaces.assertMemberRoleTx(tx, p.ownerUserId, p.workspaceId, ["owner"]);
        await this.plugins.assertEnabledTx(tx, p.ownerUserId, p.workspaceId, PLUGIN);
        // Read only after the lock: pause/revoke may have committed while we waited.
        await this.lockConnection(tx, p.connectionId);
        const connection = await tx.opportunityConnection.findFirst({ where: { id: p.connectionId, workspaceId: p.workspaceId } });
        if (!connection || connection.state === "revoked") throw new UnauthorizedException("Подключение отозвано");
        return work(tx, connection);
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.prisma.asSystem((tx) => tx.opportunityConnection.updateMany({ where: { id: p.connectionId, state: "linked" }, data: { state: "paused", pausedReason: "Права владельца подключения отозваны", revision: { increment: 1 } } }));
        throw new ForbiddenException("rights_revoked: права владельца подключения отозваны");
      }
      throw error;
    }
  }

  private async lockConnection(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM opportunity_connections WHERE id = ${id} FOR UPDATE`; }

  private leaseProblem(row: AttemptRow | null, input: RunnerLeaseInput, allowExpired = false, allowStates: string[] = ["running"]): string | null {
    if (!row) return "attempt_not_found";
    if (!allowStates.includes(row.state)) return `attempt_not_running:${row.state}`;
    if (!row.leaseHash || row.leaseHash !== sha256(input.leaseToken)) return "lease_mismatch";
    if (!allowExpired && (!row.leaseExpiresAt || row.leaseExpiresAt <= new Date())) return "lease_expired";
    return null;
  }

  private async attemptFor(tx: Tx, p: RunnerPrincipal, id: string) {
    // Serialize reserve/heartbeat/result with lease expiry, including callers on another connection.
    await tx.$queryRaw`SELECT id FROM opportunity_attempts WHERE id = ${id} AND "workspaceId" = ${p.workspaceId} AND "connectionId" = ${p.connectionId} FOR UPDATE`;
    return tx.opportunityAttempt.findFirst({ where: { id, workspaceId: p.workspaceId, connectionId: p.connectionId } });
  }

  /* ---------- claim ---------- */

  async claim(p: RunnerPrincipal): Promise<RunnerClaimResult> {
    return this.asOwner(p, async (tx, connection) => {
      const now = new Date();
      await tx.opportunityConnection.update({ where: { id: connection.id }, data: { runnerSeenAt: now } });
      await this.execution.reapTx(tx, p.workspaceId);
      if (connection.state !== "linked") return { job: null, reason: `connection_${connection.state}` };
      if (await tx.opportunityAttempt.count({ where: { workspaceId: p.workspaceId, connectionId: connection.id, state: "running" } })) return { job: null, reason: "busy", retryAfterSec: EXECUTION_LIMITS.heartbeatSec };
      const accountKey = connection.externalAccountId!;
      const budget = await tx.opportunityBudget.findUnique({ where: { workspaceId_accountKey_actionType_localDate: { workspaceId: p.workspaceId, accountKey, actionType: "apply", localDate: localDateKey(now, connection.timezone) } } });
      if (budget && budget.used >= connection.dailyLimit) return { job: null, reason: "daily_limit", retryAfterSec: secondsToLocalMidnight(now, connection.timezone) };
      const candidates = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity_attempts WHERE "workspaceId" = ${p.workspaceId} AND "connectionId" = ${connection.id} AND state = 'queued' ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!candidates.length) return { job: null, reason: "idle", retryAfterSec: 30 };
      const attempt = await tx.opportunityAttempt.findUniqueOrThrow({ where: { id: candidates[0].id } });
      const grant = await tx.opportunityGrant.findFirst({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" } });
      const problem = await this.claimProblem(tx, p, attempt, grant);
      if (problem) {
        await tx.opportunityGrant.updateMany({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" }, data: { state: problem.code === "grant_expired" ? "expired" : "revoked" } });
        await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "queued" }, data: { state: "needs_user_action", completedAt: now, errorCode: problem.code, message: problem.message, timeline: json(appendTimeline(attempt.timeline, "needs_user_action", problem.message)), revision: { increment: 1 } } });
        return { job: null, reason: problem.code, retryAfterSec: 5 };
      }
      const lease = newSecret("ohl");
      const leaseExpiresAt = new Date(now.getTime() + EXECUTION_LIMITS.leaseSec * 1000);
      const changed = await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "queued" }, data: {
        state: "running", leaseHash: lease.hash, leaseRunnerId: connection.runnerId, leaseExpiresAt, claimCount: { increment: 1 }, timeline: json(appendTimeline(attempt.timeline, "running", `Взято исполнителем ${connection.runnerId ?? ""}`)), revision: { increment: 1 }
      } });
      if (!changed.count) return { job: null, reason: "raced", retryAfterSec: 1 };
      return { job: { attemptId: attempt.id, leaseToken: lease.secret, leaseExpiresAt: leaseExpiresAt.toISOString(), heartbeatSec: EXECUTION_LIMITS.heartbeatSec, contractVersion: EXECUTOR_CONTRACT_VERSION, connection: { id: connection.id, externalAccountId: accountKey }, payload: attemptPayloadSchema.parse(attempt.payload), payloadHash: attempt.payloadHash, grantExpiresAt: grant!.expiresAt.toISOString() } };
    });
  }

  /** Все условия, которые должны быть истинны ПРЯМО СЕЙЧАС, чтобы выдать задание. */
  private async claimProblem(tx: Tx, p: RunnerPrincipal, attempt: AttemptRow, grant: { payloadHash: string; expiresAt: Date } | null): Promise<{ code: string; message: string } | null> {
    const authority = await this.delegationProblem(tx, p, attempt);
    if (authority) return { code: authority, message: "Политика больше не разрешает эту отправку. Требуется решение владельца." };
    if (!grant) return { code: "grant_missing", message: "Нет действующего разрешения. Согласуйте отправку заново." };
    if (grant.expiresAt <= new Date()) return { code: "grant_expired", message: "Разрешение истекло. Согласуйте заново." };
    if (grant.payloadHash !== attempt.payloadHash) return { code: "grant_mismatch", message: "Разрешение относится к другому содержимому." };
    if (attempt.cancelRequested) return { code: "canceled", message: "Отменено до отправки." };
    const dry = await this.execution.currentDryRunTx(tx, p.ownerUserId, p.workspaceId, attempt.draftId).catch(() => null);
    if (!dry) return { code: "content_unavailable", message: "Не удалось проверить актуальность содержимого." };
    if (dry.payloadHash !== attempt.payloadHash) return { code: "content_changed", message: "Текст, резюме, получатель или профиль изменились после согласования. Прежнее разрешение не действует." };
    if (dry.blockers.length) return { code: "content_changed", message: dry.blockers[0] };
    return null;
  }

  private delegationProblem(tx: Tx, p: RunnerPrincipal, attempt: AttemptRow): Promise<string | null> {
    return attempt.initiatedBy ? this.authorities.checkTx(tx, { reference: attempt.initiatedBy, workspaceId: p.workspaceId, ownerUserId: p.ownerUserId, connectionId: p.connectionId, profileId: attempt.profileId }) : Promise.resolve(null);
  }

  /* ---------- heartbeat ---------- */

  async heartbeat(p: RunnerPrincipal, input: RunnerLeaseInput): Promise<RunnerHeartbeatResult> {
    return this.asOwner(p, async (tx, connection) => {
      const now = new Date();
      await tx.opportunityConnection.update({ where: { id: connection.id }, data: { runnerSeenAt: now } });
      const row = await this.attemptFor(tx, p, input.attemptId);
      const problem = this.leaseProblem(row, input);
      if (problem) throw new ConflictException(problem);
      const grant = await tx.opportunityGrant.findFirst({ where: { attemptId: row!.id, workspaceId: p.workspaceId, state: "active", expiresAt: { gt: now } } });
      const leaseExpiresAt = new Date(now.getTime() + EXECUTION_LIMITS.leaseSec * 1000);
      await tx.opportunityAttempt.updateMany({ where: { id: row!.id, state: "running" }, data: { leaseExpiresAt } });
      return { leaseExpiresAt: leaseExpiresAt.toISOString(), cancelRequested: row!.cancelRequested, paused: connection.state !== "linked", grantValid: !!grant && !await this.delegationProblem(tx, p, row!) };
    });
  }

  /* ---------- reserve: обязательная контрольная точка перед нажатием ---------- */

  async reserve(p: RunnerPrincipal, input: RunnerReserveInput): Promise<RunnerReserveResult> {
    return this.asOwner(p, async (tx, connection) => {
      const now = new Date();
      const row = await this.attemptFor(tx, p, input.attemptId);
      const problem = this.leaseProblem(row, input);
      if (problem) throw new ConflictException(problem);
      const attempt = row!;
      const refuse = async (code: string, message: string, state: "needs_user_action" | "canceled" | "queued"): Promise<RunnerReserveResult> => {
        if (state === "queued") {
          await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "running" }, data: { state: "queued", leaseHash: null, leaseRunnerId: null, leaseExpiresAt: null, message, timeline: json(appendTimeline(attempt.timeline, "queued", message)), revision: { increment: 1 } } });
          return { proceed: false, reason: code, state: "queued", retryAfterSec: 60 };
        }
        await tx.opportunityGrant.updateMany({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" }, data: { state: "revoked" } });
        await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "running" }, data: { state, completedAt: now, errorCode: code, message, leaseHash: null, leaseExpiresAt: null, timeline: json(appendTimeline(attempt.timeline, state, message)), revision: { increment: 1 } } });
        return { proceed: false, reason: code, state };
      };
      if (attempt.submitReserved) return { proceed: false, reason: "already_reserved", state: "running" }; // повторный reserve никогда не даёт второго «proceed»
      if (connection.state !== "linked") return refuse("connection_paused", "Подключение приостановлено — отправка не начата.", "canceled");
      if (attempt.cancelRequested) return refuse("canceled", "Отменено до отправки.", "canceled");
      const authority = await this.delegationProblem(tx, p, attempt);
      if (authority) return refuse(authority, "Политика больше не разрешает отправку. Требуется решение владельца.", "needs_user_action");
      const grant = await tx.opportunityGrant.findFirst({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" } });
      if (!grant || grant.expiresAt <= now || grant.payloadHash !== attempt.payloadHash) return refuse("grant_invalid", "Разрешение отозвано, истекло или относится к другому содержимому.", "needs_user_action");
      const dry = await this.execution.currentDryRunTx(tx, p.ownerUserId, p.workspaceId, attempt.draftId).catch(() => null);
      if (!dry || dry.payloadHash !== attempt.payloadHash || dry.blockers.length) return refuse("content_changed", "Содержимое изменилось после согласования. Прежнее разрешение не действует.", "needs_user_action");
      if (input.observedAccountId !== connection.externalAccountId) return refuse("wrong_account", "В браузере открыт другой аккаунт HH. Отправка остановлена.", "needs_user_action");
      if (input.baselineExists) {
        const evidence = [...(attempt.evidence as Evidence[]), ...(input.baselineEvidence ? [input.baselineEvidence] : [{ kind: "baseline" as const, at: now.toISOString(), accountId: input.observedAccountId, text: "Отклик на эту вакансию уже существовал до попытки." }])];
        await tx.opportunityGrant.updateMany({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" }, data: { state: "consumed", consumedAt: now } });
        await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "running" }, data: { state: "already_exists", evidence: json(evidence), completedAt: now, leaseHash: null, leaseExpiresAt: null, message: "Отклик на эту вакансию уже существовал. Новая отправка не выполнялась.", timeline: json(appendTimeline(attempt.timeline, "already_exists", "Обнаружен существующий отклик до отправки")), revision: { increment: 1 } } });
        return { proceed: false, reason: "already_exists", state: "already_exists" };
      }
      // Один аккаунт HH = один бюджет, даже если к нему привязаны разные профили.
      const accountKey = connection.externalAccountId!;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.workspaceId + ":" + accountKey}))`;
      const peers = await tx.opportunityConnection.findMany({ where: { workspaceId: p.workspaceId, externalAccountId: accountKey }, select: { id: true } });
      const last = await tx.opportunityAttempt.findFirst({ where: { workspaceId: p.workspaceId, connectionId: { in: peers.map((c) => c.id) }, submitReserved: true, submitStartedAt: { gt: new Date(now.getTime() - connection.minIntervalSec * 1000) } }, orderBy: { submitStartedAt: "desc" } });
      if (last?.submitStartedAt) {
        const wait = Math.ceil((last.submitStartedAt.getTime() + connection.minIntervalSec * 1000 - now.getTime()) / 1000);
        return refuse("min_interval", `Слишком рано после предыдущей отправки (минимальный интервал ${connection.minIntervalSec} с).`, "queued").then((r) => ({ ...r, retryAfterSec: Math.max(wait, 1) }));
      }
      const date = localDateKey(now, connection.timezone);
      const reserved = await tx.$queryRaw<{ used: number }[]>`INSERT INTO opportunity_budgets (id, "workspaceId", "accountKey", "actionType", "localDate", used, "updatedAt") VALUES (gen_random_uuid()::text, ${p.workspaceId}, ${accountKey}, 'apply', ${date}, 1, now()) ON CONFLICT ("workspaceId", "accountKey", "actionType", "localDate") DO UPDATE SET used = opportunity_budgets.used + 1, "updatedAt" = now() WHERE opportunity_budgets.used < ${connection.dailyLimit} RETURNING used`;
      if (!reserved.length) return refuse("daily_limit", `Дневной лимит отправок исчерпан (${connection.dailyLimit}).`, "queued").then((r) => ({ ...r, retryAfterSec: secondsToLocalMidnight(now, connection.timezone) }));
      await tx.opportunityGrant.updateMany({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" }, data: { state: "consumed", consumedAt: now } });
      await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: "running" }, data: { submitReserved: true, submitStartedAt: now, timeline: json(appendTimeline(attempt.timeline, "running", "Отправка зарезервирована: бюджет списан, разрешение использовано")), revision: { increment: 1 } } });
      return { proceed: true, state: "running" };
    });
  }

  /* ---------- result ---------- */

  async result(p: RunnerPrincipal, input: RunnerResultInput): Promise<RunnerResult> {
    return this.asOwner(p, async (tx, connection) => {
      const now = new Date();
      const row = await this.attemptFor(tx, p, input.attemptId);
      // Поздний результат принимается и для «sent_unconfirmed»: он может снять неопределённость.
      const problem = this.leaseProblem(row, input, true, ["running", "sent_unconfirmed"]);
      if (problem) throw new ConflictException(problem);
      const attempt = row!;
      const recipient = attemptPayloadSchema.parse(attempt.payload).recipient.externalId ?? "";
      const decision = decideOutcome(input, { submitReserved: attempt.submitReserved, submitStartedAt: attempt.submitStartedAt, accountId: connection.externalAccountId ?? "", recipientExternalId: recipient, currentState: attempt.state as never });
      if (attempt.state === "sent_unconfirmed" && decision.state !== "confirmed") return { state: "sent_unconfirmed", accepted: false, reason: "late_result_not_confirming" };
      const evidence = [...(attempt.evidence as Evidence[]), ...input.evidence].slice(-20);
      const finalState = decision.state;
      const keepLease = finalState === "sent_unconfirmed";
      await tx.opportunityAttempt.updateMany({ where: { id: attempt.id, state: attempt.state }, data: {
        state: finalState, evidence: json(evidence), confirmationBasis: decision.basis, errorCode: decision.errorCode, message: decision.message ?? (finalState === "confirmed" ? "Отправка подтверждена исполнителем." : null),
        completedAt: now, ...(keepLease ? { leaseExpiresAt: new Date(now.getTime() + 24 * 3600_000) } : { leaseHash: null, leaseExpiresAt: null }),
        timeline: json(appendTimeline(attempt.timeline, finalState, decision.message ?? `Результат исполнителя: ${input.outcome}`)), revision: { increment: 1 }
      } });
      await tx.opportunityGrant.updateMany({ where: { attemptId: attempt.id, workspaceId: p.workspaceId, state: "active" }, data: { state: "revoked" } });
      if (decision.resetsFailures) await tx.opportunityConnection.update({ where: { id: connection.id }, data: { consecutiveFailures: 0 } });
      if (decision.systemFailure) {
        const failures = connection.consecutiveFailures + 1;
        await tx.opportunityConnection.update({ where: { id: connection.id }, data: failures >= EXECUTION_LIMITS.failuresToPause ? { consecutiveFailures: failures, state: "paused", pausedReason: `${failures} системных сбоя подряд — подключение приостановлено до проверки`, revision: { increment: 1 } } : { consecutiveFailures: failures } });
      }
      return { state: finalState, accepted: decision.accepted, ...(decision.reason ? { reason: decision.reason } : {}) };
    });
  }

  /** Диагностика для тестов и проверки владельцем: подключение, которому принадлежит токен. */
  async whoami(p: RunnerPrincipal) {
    return this.asOwner(p, async (_tx, connection) => { if (!connection) throw new NotFoundException(); return { connectionId: connection.id, state: connection.state, externalAccountId: connection.externalAccountId, contractVersion: EXECUTOR_CONTRACT_VERSION }; });
  }
}
