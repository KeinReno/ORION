import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { expect } from "vitest";
import type { Attempt, Connection, CreatedConnection, Draft, Evidence, Opportunity, OpportunityFact, RunnerBindResult, RunnerClaimResult } from "@orion/shared-types";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * Общие фикстуры интеграционных тестов Hub. ИСПОЛНИТЕЛЬ ЗДЕСЬ — ИМИТАЦИЯ: она проверяет серверный протокол
 * (аренда, резервирование, результат), но не доказывает, что реальный браузер отправит отклик на hh.ru.
 */

export const HH_DESCRIPTION = "Требования:\n- Опыт написания SQL запросов\n- Управление бэклогом";

export interface Account { token: string; userId: string; workspaceId: string; email: string }

export class Hub {
  app!: INestApplication; prisma!: PrismaService; base = "";
  readonly prefix = `hub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  readonly userIds: string[] = []; readonly workspaceIds: string[] = [];
  private counter = 0;

  async start(): Promise<void> {
    process.env.ORION_RUNNER_BIND_LIMIT = "10000";
    this.app = await NestFactory.create(AppModule, { logger: ["error"], abortOnError: false }); configureApp(this.app);
    await this.app.listen(0, "127.0.0.1");
    this.base = `http://127.0.0.1:${(this.app.getHttpServer().address() as { port: number }).port}`;
    this.prisma = this.app.get(PrismaService);
  }
  async stop(): Promise<void> {
    if (this.prisma) await this.prisma.asSystem(async (tx) => {
      await tx.workspace.deleteMany({ where: { id: { in: this.workspaceIds } } });
      await tx.user.deleteMany({ where: { id: { in: this.userIds } } });
    });
    await this.app?.close();
  }

  async req<T>(path: string, token: string, method = "GET", body?: unknown) {
    const res = await fetch(`${this.base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async register(name: string): Promise<Account> {
    const email = `${this.prefix}-${name}@example.test`;
    const res = await this.req<{ accessToken: string; user: { id: string } }>("/auth/register", "", "POST", { email, password: "integration-password-123", name });
    expect(res.status).toBe(201); this.userIds.push(res.data.user.id);
    const workspaces = await this.req<{ id: string }[]>("/workspaces/me", res.data.accessToken);
    const workspaceId = workspaces.data[0].id; this.workspaceIds.push(workspaceId);
    return { token: res.data.accessToken, userId: res.data.user.id, workspaceId, email };
  }

  async enable(a: Account, ...plugins: string[]) {
    for (const p of plugins) expect((await this.req(`/workspaces/${a.workspaceId}/plugins/${p}`, a.token, "PATCH", { enabled: true })).status).toBe(200);
  }

  profilesPath = (a: Account) => `/workspaces/${a.workspaceId}/opportunity-profiles`;
  assistantPath = (a: Account) => `/workspaces/${a.workspaceId}/opportunity-assistant`;
  execPath = (a: Account) => `/workspaces/${a.workspaceId}/opportunity-execution`;

  /** Профиль с подтверждёнными фактами и выбранным резюме; одна HH-вакансия; одобренный владельцем черновик. */
  async scenario(a: Account, opts: { externalId?: string; sourceType?: string; description?: string; organizationName?: string; profile?: { id: string; resumeId: string; factIds: string[] }; approve?: boolean; draft?: boolean; conditions?: Record<string, unknown> } = {}) {
    const externalId = opts.externalId ?? String(1000000 + ++this.counter * 7 + Math.floor(Math.random() * 1000));
    const opp = await this.req<Opportunity>(`/workspaces/${a.workspaceId}/opportunities`, a.token, "POST", {
      kind: "job", title: `Бизнес-аналитик ${externalId}`, organizationName: opts.organizationName ?? "Синтетик", description: opts.description ?? HH_DESCRIPTION, sourceType: opts.sourceType ?? "hh", externalId,
      canonicalUrl: `https://hh.ru/vacancy/${externalId}`, conditions: opts.conditions ?? { workFormat: "remote", amountMin: 150000, amountMax: 200000, paymentBasis: "monthly", taxBasis: "net" }
    });
    expect(opp.status, JSON.stringify(opp.data)).toBe(201);
    let profile = opts.profile;
    if (!profile) {
      const created = (await this.req<{ id: string }>(this.profilesPath(a), a.token, "POST", { displayName: "Синтетический Кандидат", kind: "person", acknowledgeWorkspaceVisibility: true })).data;
      const addFact = async (statement: string) => {
        const fact = (await this.req<OpportunityFact>(`${this.profilesPath(a)}/${created.id}/facts`, a.token, "POST", { statement, source: "синтетическая заметка" })).data;
        return (await this.req<OpportunityFact>(`${this.profilesPath(a)}/${created.id}/facts/${fact.id}`, a.token, "PATCH", { expectedRevision: fact.revision, state: "confirmed" })).data;
      };
      const sql = await addFact("Писал SQL запросы для отчётности"); const backlog = await addFact("Управлял бэклогом продукта пять лет");
      const resume = (await this.req<{ id: string }>(`${this.profilesPath(a)}/${created.id}/materials`, a.token, "POST", { title: "Резюме v1", type: "resume", content: "Бизнес-аналитик. SQL." })).data;
      const detail = (await this.req<{ revision: number }>(`${this.profilesPath(a)}/${created.id}`, a.token)).data;
      expect((await this.req(`${this.profilesPath(a)}/${created.id}/active-resume`, a.token, "POST", { expectedRevision: detail.revision, materialId: resume.id })).status).toBe(201);
      profile = { id: created.id, resumeId: resume.id, factIds: [sql.id, backlog.id] };
    }
    if (opts.draft === false) return { opp: opp.data, externalId, profile, draft: null as unknown as Draft };
    const draft = await this.req<Draft>(`${this.assistantPath(a)}/drafts`, a.token, "POST", { opportunityId: opp.data.id, profileId: profile.id, kind: "response" });
    expect(draft.status, JSON.stringify(draft.data)).toBe(201);
    let approved = draft.data;
    if (opts.approve !== false) {
      const res = await this.req<Draft>(`${this.assistantPath(a)}/drafts/${draft.data.id}/approve`, a.token, "POST", { expectedRevision: draft.data.revision, textHash: draft.data.textHash });
      expect(res.status, JSON.stringify(res.data)).toBe(201); approved = res.data;
    }
    return { opp: opp.data, externalId, profile, draft: approved };
  }

  async connection(a: Account, profileId: string, patch: Record<string, unknown> = {}) {
    const res = await this.req<CreatedConnection>(`${this.execPath(a)}/connections`, a.token, "POST", { profileId, accountLabel: "hh: синтетический аккаунт", ...patch });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    return res.data;
  }

  /** Имитация привязки локального исполнителя к «аккаунту» с заданным id. */
  async bind(pairingCode: string, accountId = "acc-1", runnerId = "runner-1") {
    const res = await this.req<RunnerBindResult>("/opportunities-executor/v1/bind", "", "POST", { pairingCode, externalAccountId: accountId, accountDisplay: "Синтетический аккаунт", runnerId, contractVersion: "opportunities-executor/v1" });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    return res.data;
  }

  runner(token: string) {
    const call = <T>(path: string, body?: unknown, method = "POST") => this.req<T>(`/opportunities-executor/v1/${path}`, token, method, body);
    return {
      claim: () => call<RunnerClaimResult>("claim"),
      heartbeat: (attemptId: string, leaseToken: string) => call<{ leaseExpiresAt: string; cancelRequested: boolean; paused: boolean; grantValid: boolean }>("heartbeat", { attemptId, leaseToken }),
      reserve: (attemptId: string, leaseToken: string, observedAccountId = "acc-1", baselineExists = false, baselineEvidence?: Evidence) => call<{ proceed: boolean; reason?: string; state: string; retryAfterSec?: number }>("reserve", { attemptId, leaseToken, observedAccountId, baselineExists, ...(baselineEvidence ? { baselineEvidence } : {}) }),
      result: (attemptId: string, leaseToken: string, outcome: string, evidence: Evidence[] = [], extra: Record<string, unknown> = {}) => call<{ state: string; accepted: boolean; reason?: string }>("result", { attemptId, leaseToken, outcome, evidence, ...extra }),
      whoami: () => call<{ connectionId: string; state: string }>("whoami", undefined, "GET")
    };
  }

  /** Создаёт попытку из одобренного черновика, согласовывает и возвращает её. */
  async queued(a: Account, connectionId: string, draftId: string, key = `key-${Math.random().toString(36).slice(2)}-${Date.now()}`) {
    const created = await this.req<Attempt>(`${this.execPath(a)}/attempts`, a.token, "POST", { draftId, connectionId, idempotencyKey: key });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const approved = await this.req<Attempt>(`${this.execPath(a)}/attempts/${created.data.id}/approve`, a.token, "POST", { expectedRevision: created.data.revision, payloadHash: created.data.payloadHash, ttlMinutes: 30, acknowledgeReviewNotes: true });
    expect(approved.status, JSON.stringify(approved.data)).toBe(201);
    return approved.data;
  }

  /** Сдвигает прошлые отправки в прошлое, чтобы тест не упирался в минимальный интервал между отправками. */
  async ageSubmits(a: Account) { await this.prisma.asSystem((tx) => tx.$executeRaw`UPDATE opportunity_attempts SET "submitStartedAt" = "submitStartedAt" - interval '3 hours' WHERE "workspaceId" = ${a.workspaceId} AND "submitStartedAt" IS NOT NULL`); }

  attempt = (a: Account, id: string) => this.req<Attempt>(`${this.execPath(a)}/attempts/${id}`, a.token);
  connections = (a: Account) => this.req<Connection[]>(`${this.execPath(a)}/connections`, a.token);

  /** Доказательство, которое подтверждает ЭТУ отправку (событие HH для того же аккаунта и вакансии). */
  confirming(externalId: string, accountId = "acc-1"): Evidence { return { kind: "event_id", at: new Date().toISOString(), accountId, recipientExternalId: externalId, ref: `hh-negotiation-${externalId}` }; }
}
