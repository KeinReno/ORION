import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { OpportunityAttempt as AttemptRow, OpportunityConnection as ConnectionRow, OpportunityGrant as GrantRow, Prisma } from "@prisma/client";
import {
  EXECUTION_LIMITS, TERMINAL_ATTEMPT_STATES, attemptSchema, connectionSchema, createdConnectionSchema,
  type ApproveAttemptInput, type Attempt, type AttemptState, type CancelAttemptInput, type Connection, type ConnectionActionInput, type CreateAttemptInput, type CreateConnectionInput, type CreatedConnection, type DryRun, type Evidence, type ReconcileAttemptInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { CapabilityLifecycle } from "../common/capability-lifecycle";
import { PluginsService } from "../plugins/plugins.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { ASSISTANT_DRAFT_PORT, type AssistantDraftPort } from "../opportunities-assistant/public";
import { PROFILE_EVIDENCE_PORT, type ProfileEvidencePort } from "../opportunities-profiles/public";
import { appendTimeline, hhRecipientProblem, newSecret } from "./exec-core";
import type { ExecutionAutomationPort } from "./automation-contract";

type Tx = Prisma.TransactionClient;
const PLUGIN = "opportunities-execution" as const;
const PAGE = 20;
const ONLINE_MS = 120_000;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export function connectionDto(row: ConnectionRow, now = new Date()): Connection {
  return connectionSchema.parse({
    id: row.id, workspaceId: row.workspaceId, profileId: row.profileId, provider: "hh", accountLabel: row.accountLabel, externalAccountId: row.externalAccountId, accountDisplay: row.accountDisplay,
    state: row.state, pausedReason: row.pausedReason, dailyLimit: row.dailyLimit, minIntervalSec: row.minIntervalSec, timezone: row.timezone, consecutiveFailures: row.consecutiveFailures,
    runnerSeenAt: row.runnerSeenAt?.toISOString() ?? null, runnerOnline: !!row.runnerSeenAt && now.getTime() - row.runnerSeenAt.getTime() < ONLINE_MS && row.state === "linked",
    linkedAt: row.linkedAt?.toISOString() ?? null, revision: row.revision, createdAt: row.createdAt.toISOString()
  });
}

export function attemptDto(row: AttemptRow, grant: GrantRow | null, invalid: { invalidated: boolean; reasons: string[] } = { invalidated: false, reasons: [] }): Attempt {
  const grantState = !grant ? "none" : grant.state === "active" && grant.expiresAt <= new Date() ? "expired" : grant.state;
  return attemptSchema.parse({
    id: row.id, workspaceId: row.workspaceId, opportunityId: row.opportunityId, profileId: row.profileId, connectionId: row.connectionId, draftId: row.draftId, actionType: "apply",
    idempotencyKey: row.idempotencyKey, state: row.state, payload: row.payload, payloadHash: row.payloadHash, reviewNotes: row.reviewNotes, reviewAcknowledged: row.reviewAcknowledged,
    grant: { state: grantState, expiresAt: grant?.expiresAt.toISOString() ?? null, grantedBy: grant?.grantedBy ?? null },
    invalidated: invalid.invalidated, invalidReasons: invalid.reasons, initiatedBy: row.initiatedBy, cancelRequested: row.cancelRequested, submitReserved: row.submitReserved, claimCount: row.claimCount,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null, evidence: row.evidence, confirmationBasis: row.confirmationBasis, errorCode: row.errorCode, message: row.message,
    timeline: row.timeline, revision: row.revision, createdBy: row.createdById, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null
  });
}

@Injectable()
export class ExecutionService implements ExecutionAutomationPort {
  constructor(
    private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService, private readonly plugins: PluginsService,
    @Inject(ASSISTANT_DRAFT_PORT) private readonly drafts: AssistantDraftPort,
    @Inject(PROFILE_EVIDENCE_PORT) private readonly profiles: ProfileEvidencePort,
    private readonly lifecycle: CapabilityLifecycle
  ) {}

  onModuleInit(): void {
    this.lifecycle.register("opportunities-execution", async (tx, change) => {
      if (change.enabled || !(change.kind === "module" ? change.id === "opportunities" : ["opportunities-profiles", "opportunities-assistant", "opportunities-execution"].includes(change.id))) return;
      const ws = change.workspaceId;
      await tx.$queryRaw`SELECT id FROM opportunity_connections WHERE "workspaceId" = ${ws} AND state <> 'revoked' ORDER BY id FOR UPDATE`;
      const rows = await tx.opportunityConnection.findMany({ where: { workspaceId: ws, state: { not: "revoked" } } });
      for (const row of rows) {
        await tx.opportunityConnection.update({ where: { id: row.id }, data: { ...(row.state === "linked" ? { state: "paused", pausedReason: "Необходимый компонент выключен — требуется явное возобновление" } : {}), pairingHash: null, pairingExpiresAt: null, revision: { increment: 1 } } });
        await this.stopWorkTx(tx, ws, row.id, "Необходимый компонент выключен. Разрешение отозвано.");
      }
    });
  }

  /** Подключение аккаунта, разрешения и отправка — только владельцу пространства (ТЗ §4.2). */
  async guard(tx: Tx, user: string, ws: string) {
    await this.workspaces.assertMemberRoleTx(tx, user, ws, ["owner"]);
    await this.plugins.assertEnabledTx(tx, user, ws, PLUGIN);
  }

  /* ---------------- Подключения ---------------- */

  async createConnection(user: string, ws: string, input: CreateConnectionInput): Promise<CreatedConnection> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const evidence = await this.profiles.readEvidenceTx(tx, user, ws, input.profileId);
      if (evidence.profile.archivedAt) throw new ConflictException("Профиль в архиве. Восстановите его перед подключением аккаунта.");
      if (await tx.opportunityConnection.findFirst({ where: { workspaceId: ws, profileId: input.profileId, state: { not: "revoked" } } })) throw new ConflictException("У профиля уже есть подключение. Отзовите его, чтобы создать новое.");
      const pairing = newSecret("ohp");
      const row = await tx.opportunityConnection.create({ data: {
        workspaceId: ws, profileId: input.profileId, ownerUserId: user, accountLabel: input.accountLabel, dailyLimit: input.dailyLimit, minIntervalSec: input.minIntervalSec, timezone: input.timezone,
        pairingHash: pairing.hash, pairingExpiresAt: new Date(Date.now() + EXECUTION_LIMITS.pairingMinutes * 60_000)
      } });
      return createdConnectionSchema.parse({ ...connectionDto(row), pairingCode: pairing.secret, pairingExpiresAt: row.pairingExpiresAt!.toISOString() });
    });
  }

  async listConnections(user: string, ws: string): Promise<Connection[]> {
    return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); return (await tx.opportunityConnection.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 50 })).map((r) => connectionDto(r)); });
  }

  private async loadConnection(tx: Tx, ws: string, id: string): Promise<ConnectionRow> {
    const row = await tx.opportunityConnection.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Подключение не найдено");
    return row;
  }

  /** Остановка будущей работы: разрешения отзываются, очередь отменяется, выполняющееся до отправки получает запрос прервать. Уже начатая отправка не отменяется. */
  async stopWorkTx(tx: Tx, ws: string, connectionId: string, note: string): Promise<void> {
    const now = new Date();
    await tx.$queryRaw`SELECT id FROM opportunity_attempts WHERE "workspaceId" = ${ws} AND "connectionId" = ${connectionId} AND state IN ('queued', 'awaiting_approval', 'running') ORDER BY id FOR UPDATE`;
    const queued = await tx.opportunityAttempt.findMany({ where: { workspaceId: ws, connectionId, state: { in: ["queued", "awaiting_approval"] } } });
    for (const a of queued) {
      await tx.opportunityGrant.updateMany({ where: { attemptId: a.id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
      await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: a.state }, data: { state: "canceled", completedAt: now, errorCode: "stopped", message: note, timeline: json(appendTimeline(a.timeline, "canceled", note)), revision: { increment: 1 } } });
    }
    await tx.opportunityAttempt.updateMany({ where: { workspaceId: ws, connectionId, state: "running", submitReserved: false }, data: { cancelRequested: true } });
    await tx.opportunityGrant.updateMany({ where: { workspaceId: ws, state: "active", attempt: { connectionId, state: "running", submitReserved: false } }, data: { state: "revoked" } });
  }

  private async changeConnection(user: string, ws: string, id: string, input: ConnectionActionInput, kind: "pause" | "resume" | "stop" | "revoke"): Promise<Connection> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      const row = await this.loadConnection(tx, ws, id);
      if (row.revision !== input.expectedRevision) throw new ConflictException("Подключение изменено в другом окне. Обновите данные.");
      if (row.state === "revoked") throw new ConflictException("Подключение отозвано. Создайте новое.");
      const data: Prisma.OpportunityConnectionUpdateManyMutationInput = { revision: { increment: 1 } };
      if (kind === "pause" || kind === "stop") {
        if (row.state === "pending_link") throw new ConflictException("Исполнитель ещё не подключён.");
        data.state = "paused"; data.pausedReason = input.reason ?? (kind === "stop" ? "Остановлено владельцем" : "Приостановлено владельцем");
      } else if (kind === "resume") {
        if (row.state !== "paused") throw new ConflictException("Подключение не приостановлено.");
        if (!row.runnerTokenHash || !row.externalAccountId) throw new ConflictException("Исполнитель не привязан к аккаунту. Создайте новое подключение.");
        data.state = "linked"; data.pausedReason = null; data.consecutiveFailures = 0;
      } else {
        data.state = "revoked"; data.pausedReason = input.reason ?? "Отозвано владельцем"; data.runnerTokenHash = null; data.pairingHash = null; data.pairingExpiresAt = null; data.runnerId = null;
      }
      const changed = await tx.opportunityConnection.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision }, data });
      if (!changed.count) throw new ConflictException("Подключение изменено в другом окне. Обновите данные.");
      if (kind === "stop" || kind === "revoke" || kind === "pause") await this.stopWorkTx(tx, ws, id, kind === "revoke" ? "Подключение отозвано." : kind === "stop" ? "Остановлено владельцем." : "Подключение приостановлено — очередь отменена.");
      return connectionDto(await this.loadConnection(tx, ws, id));
    });
  }
  pause(user: string, ws: string, id: string, input: ConnectionActionInput) { return this.changeConnection(user, ws, id, input, "pause"); }
  resume(user: string, ws: string, id: string, input: ConnectionActionInput) { return this.changeConnection(user, ws, id, input, "resume"); }
  stop(user: string, ws: string, id: string, input: ConnectionActionInput) { return this.changeConnection(user, ws, id, input, "stop"); }
  revoke(user: string, ws: string, id: string, input: ConnectionActionInput) { return this.changeConnection(user, ws, id, input, "revoke"); }

  /* ---------------- Обслуживание: аренда, срок разрешения, устаревшее содержимое ---------------- */

  /** Истёкшая аренда после резервирования отправки = «отправка не подтверждена»; до него — безопасный возврат в очередь. Идемпотентно и без побочных отправок. */
  async reapTx(tx: Tx, ws: string): Promise<void> {
    const now = new Date();
    // Prisma DateTime columns are UTC timestamp WITHOUT time zone. Bind an explicit timestamp,
    // otherwise PostgreSQL converts a timestamptz parameter using the machine's local zone.
    const lostIds = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity_attempts WHERE "workspaceId" = ${ws} AND state = 'running' AND "leaseExpiresAt" < ${now.toISOString()}::timestamp ORDER BY id FOR UPDATE SKIP LOCKED`;
    const lost = await tx.opportunityAttempt.findMany({ where: { id: { in: lostIds.map((row) => row.id) } } });
    for (const a of lost) {
      if (a.submitReserved) {
        await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: "running" }, data: { state: "sent_unconfirmed", errorCode: "lease_expired_after_submit", message: "Исполнитель пропал после начала отправки. Отправка могла произойти; повторная отправка запрещена до сверки.", completedAt: now, timeline: json(appendTimeline(a.timeline, "sent_unconfirmed", "Аренда истекла после начала отправки")), revision: { increment: 1 } } });
        continue;
      }
      const grant = await tx.opportunityGrant.findFirst({ where: { attemptId: a.id, workspaceId: ws, state: "active", expiresAt: { gt: now } } });
      const connection = await tx.opportunityConnection.findFirst({ where: { id: a.connectionId, workspaceId: ws } });
      if (grant && !a.cancelRequested && connection?.state === "linked") {
        await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: "running" }, data: { state: "queued", leaseHash: null, leaseRunnerId: null, leaseExpiresAt: null, timeline: json(appendTimeline(a.timeline, "queued", "Аренда истекла до отправки — возвращено в очередь")), revision: { increment: 1 } } });
      } else {
        await tx.opportunityGrant.updateMany({ where: { attemptId: a.id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
        await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: "running" }, data: { state: a.cancelRequested ? "canceled" : "needs_user_action", leaseHash: null, leaseExpiresAt: null, completedAt: now, errorCode: a.cancelRequested ? "canceled" : "lease_expired", message: a.cancelRequested ? "Отменено до отправки." : "Аренда истекла, а разрешение или подключение уже недействительны.", timeline: json(appendTimeline(a.timeline, a.cancelRequested ? "canceled" : "needs_user_action", "Аренда истекла")), revision: { increment: 1 } } });
      }
    }
    // Срок разрешения вышел: согласованное, но не начатое — снова требует решения человека.
    const expired = await tx.opportunityGrant.findMany({ where: { workspaceId: ws, state: "active", expiresAt: { lt: now } } });
    for (const g of expired) {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity_attempts WHERE id = ${g.attemptId} AND "workspaceId" = ${ws} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) continue;
      await tx.opportunityGrant.updateMany({ where: { id: g.id, state: "active" }, data: { state: "expired" } });
      const a = await tx.opportunityAttempt.findFirst({ where: { id: g.attemptId, workspaceId: ws } });
      if (a?.state === "queued") await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: "queued" }, data: { state: "needs_user_action", completedAt: now, errorCode: "grant_expired", message: "Разрешение истекло до начала отправки. Согласуйте заново.", timeline: json(appendTimeline(a.timeline, "needs_user_action", "Срок разрешения истёк")), revision: { increment: 1 } } });
    }
  }

  /** Совпадает ли ТЕКУЩЕЕ содержимое черновика/резюме/получателя с тем, что согласовывалось. */
  async currentDryRunTx(tx: Tx, user: string, ws: string, draftId: string): Promise<DryRun> {
    return (await this.drafts.readForExecutionTx(tx, user, ws, draftId)).dryRun;
  }

  private async invalidationTx(tx: Tx, user: string, ws: string, row: AttemptRow): Promise<{ invalidated: boolean; reasons: string[] }> {
    if (row.state !== "awaiting_approval" && row.state !== "queued" && row.state !== "running") return { invalidated: false, reasons: [] };
    try {
      const dry = await this.currentDryRunTx(tx, user, ws, row.draftId);
      const reasons: string[] = [];
      if (dry.payloadHash !== row.payloadHash) reasons.push("Текст, резюме, получатель или профиль изменились после создания отправки — прежнее согласование не действует.");
      reasons.push(...dry.blockers);
      return { invalidated: reasons.length > 0, reasons: [...new Set(reasons)].slice(0, 6) };
    } catch { return { invalidated: true, reasons: ["Не удалось проверить актуальность содержимого."] }; }
  }

  /** Недействительное содержимое отзывает разрешение: согласованное не может уйти в изменённом виде. */
  async invalidateStaleTx(tx: Tx, user: string, ws: string): Promise<void> {
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM opportunity_attempts WHERE "workspaceId" = ${ws} AND state = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED`;
    const rows = await tx.opportunityAttempt.findMany({ where: { id: { in: ids.map((row) => row.id) } } });
    for (const a of rows) {
      const inv = await this.invalidationTx(tx, user, ws, a);
      if (!inv.invalidated) continue;
      await tx.opportunityGrant.updateMany({ where: { attemptId: a.id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
      await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: "queued" }, data: { state: "needs_user_action", completedAt: new Date(), errorCode: "content_changed", message: inv.reasons[0] ?? "Содержимое изменилось.", timeline: json(appendTimeline(a.timeline, "needs_user_action", "Разрешение отозвано: содержимое изменилось")), revision: { increment: 1 } } });
    }
  }

  /* ---------------- Попытки ---------------- */

  private async withGrant(tx: Tx, user: string, ws: string, row: AttemptRow): Promise<Attempt> {
    const grant = await tx.opportunityGrant.findFirst({ where: { attemptId: row.id, workspaceId: ws }, orderBy: { createdAt: "desc" } });
    return attemptDto(row, grant, await this.invalidationTx(tx, user, ws, row));
  }

  private async loadAttempt(tx: Tx, ws: string, id: string): Promise<AttemptRow> {
    // All mutations acquire the attempt before its grant; runner reserve uses the same order.
    await tx.$queryRaw`SELECT id FROM opportunity_attempts WHERE id = ${id} AND "workspaceId" = ${ws} FOR UPDATE`;
    const row = await tx.opportunityAttempt.findFirst({ where: { id, workspaceId: ws } });
    if (!row) throw new NotFoundException("Отправка не найдена");
    return row;
  }

  async createAttempt(user: string, ws: string, input: CreateAttemptInput): Promise<Attempt> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      return this.createAttemptTx(tx, user, ws, input, null);
    });
  }

  private async createAttemptTx(tx: Tx, user: string, ws: string, input: CreateAttemptInput, initiatedBy: string | null): Promise<Attempt> {
    await tx.$queryRaw`SELECT id FROM opportunity_connections WHERE id = ${input.connectionId} AND "workspaceId" = ${ws} FOR UPDATE`;
    const connection = await this.loadConnection(tx, ws, input.connectionId);
    if (connection.state !== "linked") throw new ConflictException(connection.state === "paused" ? "Подключение приостановлено." : connection.state === "revoked" ? "Подключение отозвано." : "Исполнитель ещё не подключён к аккаунту.");
    const { draft, dryRun } = await this.drafts.readForExecutionTx(tx, user, ws, input.draftId);
    if (draft.profileId !== connection.profileId) throw new ConflictException("Подключение принадлежит другому профилю, чем черновик.");
    const existing = await tx.opportunityAttempt.findFirst({ where: { workspaceId: ws, idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.payloadHash !== dryRun.payloadHash || existing.connectionId !== connection.id) throw new ConflictException("Этот ключ уже использован для другого содержимого. Используйте новый ключ.");
      return this.withGrant(tx, user, ws, existing);
    }
    const problem = hhRecipientProblem(dryRun.payload.recipient);
    if (problem) throw new ConflictException(problem);
    if (dryRun.blockers.length) throw new ConflictException({ message: "Отправка пока невозможна.", blockers: dryRun.blockers });
    try {
      const row = await tx.opportunityAttempt.create({ data: {
        workspaceId: ws, opportunityId: draft.opportunityId, profileId: draft.profileId, connectionId: connection.id, draftId: draft.id, idempotencyKey: input.idempotencyKey,
        payload: json(dryRun.payload), payloadHash: dryRun.payloadHash, reviewNotes: json(dryRun.reviewNotes), createdById: user, initiatedBy,
        timeline: json(appendTimeline([], "awaiting_approval", "Создано из одобренного черновика"))
      } });
      return this.withGrant(tx, user, ws, row);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw new ConflictException("По этой вакансии у профиля уже есть активная или завершённая отправка.");
      throw error;
    }
  }

  async listAttempts(user: string, ws: string, q: { cursor?: string; connectionId?: string; state?: string }) {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      await this.reapTx(tx, ws); await this.invalidateStaleTx(tx, user, ws);
      if (q.cursor && !await tx.opportunityAttempt.findFirst({ where: { id: q.cursor, workspaceId: ws } })) throw new NotFoundException("Отправка не найдена");
      const rows = await tx.opportunityAttempt.findMany({ where: { workspaceId: ws, ...(q.connectionId ? { connectionId: q.connectionId } : {}), ...(q.state ? { state: q.state } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: PAGE + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
      const items: Attempt[] = [];
      for (const row of rows.slice(0, PAGE)) items.push(await this.withGrant(tx, user, ws, row));
      return { items, nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null };
    });
  }

  async getAttempt(user: string, ws: string, id: string): Promise<Attempt> {
    return this.prisma.withUser(user, async (tx) => { await this.guard(tx, user, ws); await this.reapTx(tx, ws); await this.invalidateStaleTx(tx, user, ws); return this.withGrant(tx, user, ws, await this.loadAttempt(tx, ws, id)); });
  }

  /** Разрешение = конкретный неизменяемый payload, один раз, на ограниченный срок. Не «галочка»: содержимое пересчитывается в момент согласования. */
  async approveAttempt(user: string, ws: string, id: string, input: ApproveAttemptInput): Promise<Attempt> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      return this.approveAttemptTx(tx, user, ws, id, input, user);
    });
  }

  /** `grantedBy` — пользователь или ссылка на политику менеджера (`policy:<id>`): делегированное разрешение видно в данных. */
  private async approveAttemptTx(tx: Tx, user: string, ws: string, id: string, input: ApproveAttemptInput, grantedBy: string): Promise<Attempt> {
    await this.reapTx(tx, ws);
    const row = await this.loadAttempt(tx, ws, id);
    if (row.revision !== input.expectedRevision) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
    if (row.state !== "awaiting_approval") throw new ConflictException(`Согласовать можно только отправку в состоянии «ждёт согласования» (сейчас: ${row.state}).`);
    if (row.payloadHash !== input.payloadHash) throw new ConflictException("Хэш не совпадает с тем, что вы видели. Обновите данные и проверьте содержимое.");
    const connection = await this.loadConnection(tx, ws, row.connectionId);
    if (connection.state !== "linked") throw new ConflictException("Подключение не активно — согласование невозможно.");
    const dry = await this.currentDryRunTx(tx, user, ws, row.draftId);
    if (dry.payloadHash !== row.payloadHash) throw new ConflictException("Содержимое изменилось после создания отправки. Создайте её заново и проверьте текст.");
    if (dry.blockers.length) throw new ConflictException({ message: "Отправка пока невозможна.", blockers: dry.blockers });
    const notes = row.reviewNotes as string[];
    if (notes.length && !input.acknowledgeReviewNotes) throw new ConflictException({ message: "Есть замечания, которые нужно принять осознанно.", reviewNotes: notes });
    const changed = await tx.opportunityAttempt.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision, state: "awaiting_approval" }, data: {
      state: "queued", reviewAcknowledged: notes.length > 0, timeline: json(appendTimeline(row.timeline, "queued", `Согласовано владельцем на ${input.ttlMinutes} мин. Разрешение привязано к хэшу ${row.payloadHash.slice(0, 12)}…`)), revision: { increment: 1 }
    } });
    if (!changed.count) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
    await tx.opportunityGrant.create({ data: { workspaceId: ws, attemptId: id, payloadHash: row.payloadHash, grantedBy, expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000) } });
    return this.withGrant(tx, user, ws, await this.loadAttempt(tx, ws, id));
  }

  async cancelAttempt(user: string, ws: string, id: string, input: CancelAttemptInput): Promise<Attempt> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      await this.reapTx(tx, ws);
      const row = await this.loadAttempt(tx, ws, id);
      if (row.revision !== input.expectedRevision) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
      if (TERMINAL_ATTEMPT_STATES.includes(row.state as AttemptState) || row.state === "sent_unconfirmed") throw new ConflictException(row.state === "sent_unconfirmed" ? "Отправка могла произойти — отменить нельзя, выполните сверку." : "Отправка уже завершена.");
      if (row.state === "running") {
        if (row.submitReserved) throw new ConflictException("Отправка уже начата — отменить нельзя. Дождитесь результата или сверки.");
        await tx.opportunityAttempt.updateMany({ where: { id, state: "running", submitReserved: false, revision: input.expectedRevision }, data: { cancelRequested: true, timeline: json(appendTimeline(row.timeline, "running", "Владелец запросил отмену до отправки")), revision: { increment: 1 } } });
        await tx.opportunityGrant.updateMany({ where: { attemptId: id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
        return this.withGrant(tx, user, ws, await this.loadAttempt(tx, ws, id));
      }
      await tx.opportunityGrant.updateMany({ where: { attemptId: id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
      const changed = await tx.opportunityAttempt.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision, state: row.state }, data: { state: "canceled", completedAt: new Date(), errorCode: "canceled", message: "Отменено владельцем.", timeline: json(appendTimeline(row.timeline, "canceled", "Отменено владельцем")), revision: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
      return this.withGrant(tx, user, ws, await this.loadAttempt(tx, ws, id));
    });
  }

  /** Сверка неопределённого результата человеком. Никогда не запускает отправку: «не отправлено» только разрешает создать НОВУЮ попытку с новым согласованием. */
  async reconcileAttempt(user: string, ws: string, id: string, input: ReconcileAttemptInput): Promise<Attempt> {
    return this.prisma.withUser(user, async (tx) => {
      await this.guard(tx, user, ws);
      await this.reapTx(tx, ws);
      const row = await this.loadAttempt(tx, ws, id);
      if (row.revision !== input.expectedRevision) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
      if (row.state !== "sent_unconfirmed") throw new ConflictException("Сверка нужна только для отправки без подтверждения.");
      const evidence: Evidence[] = [...(row.evidence as Evidence[]), { kind: "owner_attested", at: new Date().toISOString(), text: (input.note ?? (input.outcome === "sent" ? "Владелец проверил на стороне HH: отклик есть." : "Владелец проверил на стороне HH: отклика нет.")).slice(0, 500) }];
      const sent = input.outcome === "sent";
      const changed = await tx.opportunityAttempt.updateMany({ where: { id, workspaceId: ws, revision: input.expectedRevision, state: "sent_unconfirmed" }, data: {
        state: sent ? "confirmed" : "failed_before_send", confirmationBasis: sent ? "owner_attested" : null, evidence: json(evidence), completedAt: new Date(), errorCode: sent ? null : "owner_reported_not_sent",
        message: sent ? "Подтверждено владельцем (не наблюдалось исполнителем)." : "Владелец сообщил, что отклика нет. Повторить можно только новой отправкой с новым согласованием.",
        timeline: json(appendTimeline(row.timeline, sent ? "confirmed" : "failed_before_send", sent ? "Сверка владельцем: отправлено" : "Сверка владельцем: не отправлено")), revision: { increment: 1 }
      } });
      if (!changed.count) throw new ConflictException("Отправка изменена в другом окне. Обновите данные.");
      return this.withGrant(tx, user, ws, await this.loadAttempt(tx, ws, id));
    });
  }

  /* ---------------- Порт автоматизации (ИИ-менеджер) ---------------- */

  /** Создаёт и сразу согласовывает отправку от имени политики на короткий срок. Все проверки обычной отправки сохраняются. */
  async queueByPolicyTx(tx: Tx, ownerUserId: string, ws: string, input: { connectionId: string; draftId: string; policyRef: string; idempotencyKey: string; ttlMinutes: number }): Promise<Attempt> {
    await this.guard(tx, ownerUserId, ws);
    const created = await this.createAttemptTx(tx, ownerUserId, ws, { draftId: input.draftId, connectionId: input.connectionId, idempotencyKey: input.idempotencyKey }, input.policyRef);
    if (created.reviewNotes.length) throw new ConflictException({ message: "Политика не может принять замечания за владельца.", reviewNotes: created.reviewNotes });
    return this.approveAttemptTx(tx, ownerUserId, ws, created.id, { expectedRevision: created.revision, payloadHash: created.payloadHash, ttlMinutes: input.ttlMinutes, acknowledgeReviewNotes: false }, input.policyRef);
  }

  /** Отменяет ещё не начатую работу политики (очередь и ожидающее согласования); начатая отправка не затрагивается. */
  async cancelByPolicyTx(tx: Tx, ws: string, policyRef: string, note: string): Promise<number> {
    await tx.$queryRaw`SELECT id FROM opportunity_attempts WHERE "workspaceId" = ${ws} AND "initiatedBy" = ${policyRef} AND state IN ('queued', 'awaiting_approval', 'running') ORDER BY id FOR UPDATE`;
    const rows = await tx.opportunityAttempt.findMany({ where: { workspaceId: ws, initiatedBy: policyRef, state: { in: ["queued", "awaiting_approval"] } } });
    const now = new Date();
    let count = 0;
    for (const a of rows) {
      await tx.opportunityGrant.updateMany({ where: { attemptId: a.id, workspaceId: ws, state: "active" }, data: { state: "revoked" } });
      const res = await tx.opportunityAttempt.updateMany({ where: { id: a.id, state: a.state }, data: { state: "canceled", completedAt: now, errorCode: "policy_stopped", message: note, timeline: json(appendTimeline(a.timeline, "canceled", note)), revision: { increment: 1 } } });
      count += res.count;
    }
    await tx.opportunityAttempt.updateMany({ where: { workspaceId: ws, initiatedBy: policyRef, state: "running", submitReserved: false }, data: { cancelRequested: true } });
    await tx.opportunityGrant.updateMany({ where: { workspaceId: ws, state: "active", attempt: { initiatedBy: policyRef, state: "running", submitReserved: false } }, data: { state: "revoked" } });
    return count;
  }

  /** Итоги отправок политики по состояниям (после обслуживания аренд и сроков). */
  async statsByPolicyTx(tx: Tx, ws: string, policyRef: string): Promise<Record<string, number>> {
    await this.reapTx(tx, ws);
    const grouped = await tx.opportunityAttempt.groupBy({ by: ["state"], where: { workspaceId: ws, initiatedBy: policyRef }, _count: { _all: true } });
    return Object.fromEntries(grouped.map((g) => [g.state, g._count._all]));
  }
}
