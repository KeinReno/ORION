import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Attempt, Connection, CreatedConnection } from "@orion/shared-types";
import { SnapshotService } from "../src/sync/snapshot.service";
import { Hub, type Account } from "./opportunity-hub-fixtures";

/** R1.1: лимиты, гонки, права, подключение и восстановление. Исполнитель — имитация протокола. */
describe("Execution: limits, rights, pairing, restore", () => {
  const hub = new Hub();
  beforeAll(() => hub.start());
  afterAll(() => hub.stop());

  async function setup(name: string, connection: Record<string, unknown> = {}, accountId?: string) {
    const a = await hub.register(name); await hub.enable(a, "opportunities-profiles", "opportunities-assistant", "opportunities-execution");
    const s = await hub.scenario(a);
    const conn = await hub.connection(a, s.profile.id, connection);
    const account = accountId ?? `acc-${name}`;
    const bound = await hub.bind(conn.pairingCode, account, `runner-${name}`);
    return { a, s, conn, runner: hub.runner(bound.runnerToken), token: bound.runnerToken, account };
  }
  const claim = async (runner: ReturnType<Hub["runner"]>) => (await runner.claim()).data;

  it("disabling any execution dependency permanently revokes queued/running grants; re-enabling never resurrects them", async () => {
    for (const component of ["opportunities-profiles", "opportunities-assistant", "opportunities-execution", "module"]) {
      const { a, s, conn, runner, account } = await setup(`dependency-${component}`);
      const first = await hub.queued(a, conn.id, s.draft.id);
      const second = await hub.queued(a, conn.id, (await hub.scenario(a, { profile: s.profile })).draft.id);
      const job = (await claim(runner)).job!;
      expect(job.attemptId).toBe(first.id);
      const path = component === "module" ? `/workspaces/${a.workspaceId}/modules/opportunities` : `/workspaces/${a.workspaceId}/plugins/${component}`;
      expect((await hub.req(path, a.token, "PATCH", { enabled: false })).status).toBe(200);
      expect((await hub.req(path, a.token, "PATCH", { enabled: true })).status).toBe(200);
      expect((await hub.attempt(a, second.id)).data).toMatchObject({ state: "canceled", grant: { state: "revoked" } });
      expect((await hub.attempt(a, first.id)).data).toMatchObject({ state: "running", cancelRequested: true, grant: { state: "revoked" } });
      expect((await hub.connections(a)).data[0].state).toBe("paused");
      expect((await runner.reserve(first.id, job.leaseToken, account)).data.proceed).toBe(false);
      expect((await claim(runner)).job).toBeNull();
    }
  });

  it("claim reads the latest connection state after waiting for an owner's concurrent pause", async () => {
    const { a, s, conn, runner } = await setup("pause-race");
    await hub.queued(a, conn.id, s.draft.id);
    let release!: () => void; let locked!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const owner = hub.prisma.withUser(a.userId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM opportunity_connections WHERE id = ${conn.id} FOR UPDATE`;
      locked(); await gate;
      await tx.opportunityConnection.update({ where: { id: conn.id }, data: { state: "paused", revision: { increment: 1 } } });
    });
    await ready;
    const pending = runner.claim();
    try {
      let waiting = false;
      for (let n = 0; n < 100; n += 1) {
        const rows = await hub.prisma.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%opportunity_connections%' AND pid <> pg_backend_pid()) AS waiting`;
        if (rows[0].waiting) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); await owner; }
    expect((await pending).data).toMatchObject({ job: null, reason: "connection_paused" });
  });

  it("daily limit and minimum interval are enforced by the database counter; a refused reserve returns the job to the queue", async () => {
    const { a, s, conn, runner, account } = await setup("limit", { dailyLimit: 1 });
    const s2 = await hub.scenario(a, { profile: s.profile });
    const first = await hub.queued(a, conn.id, s.draft.id); const second = await hub.queued(a, conn.id, s2.draft.id);
    const job1 = (await claim(runner)).job!;
    expect(job1.attemptId).toBe(first.id);
    expect((await runner.reserve(first.id, job1.leaseToken, account)).data.proceed).toBe(true);
    await runner.result(first.id, job1.leaseToken, "confirmed", [hub.confirming(s.externalId, account)]);
    // лимит исчерпан: задание не выдаётся, подсказка — до локальной полуночи
    const blocked = await claim(runner);
    expect(blocked.job).toBeNull(); expect(blocked.reason).toBe("daily_limit"); expect(blocked.retryAfterSec).toBeGreaterThan(60);
    expect((await hub.attempt(a, second.id)).data.state).toBe("queued");
    const used = await hub.prisma.asSystem((tx) => tx.opportunityBudget.findFirstOrThrow({ where: { workspaceId: a.workspaceId } }));
    expect(used).toMatchObject({ used: 1, accountKey: account });
  });

  it("minimum interval between submits: the second reserve is refused and the job is requeued", async () => {
    const { a, s, conn, runner, account } = await setup("interval", { dailyLimit: 5 });
    const s2 = await hub.scenario(a, { profile: s.profile });
    const first = await hub.queued(a, conn.id, s.draft.id); const second = await hub.queued(a, conn.id, s2.draft.id);
    const j1 = (await claim(runner)).job!;
    await runner.reserve(first.id, j1.leaseToken, account);
    await runner.result(first.id, j1.leaseToken, "confirmed", [hub.confirming(s.externalId, account)]);
    const j2 = (await claim(runner)).job!;
    expect(j2.attemptId).toBe(second.id);
    const early = await runner.reserve(second.id, j2.leaseToken, account);
    expect(early.data).toMatchObject({ proceed: false, reason: "min_interval", state: "queued" });
    expect(early.data.retryAfterSec).toBeGreaterThan(0);
    expect((await hub.attempt(a, second.id)).data).toMatchObject({ state: "queued", submitReserved: false });
    await hub.ageSubmits(a);
    const j3 = (await claim(runner)).job!;
    expect((await runner.reserve(second.id, j3.leaseToken, account)).data.proceed).toBe(true);
  });

  it("two connections to the SAME hh account share one budget: concurrent reserves let exactly one through", async () => {
    const a = await hub.register("shared"); await hub.enable(a, "opportunities-profiles", "opportunities-assistant", "opportunities-execution");
    const s1 = await hub.scenario(a); const s2 = await hub.scenario(a);
    const c1 = await hub.connection(a, s1.profile.id, { dailyLimit: 1 }); const c2 = await hub.connection(a, s2.profile.id, { dailyLimit: 1 });
    const r1 = hub.runner((await hub.bind(c1.pairingCode, "acc-shared", "r1")).runnerToken); const r2 = hub.runner((await hub.bind(c2.pairingCode, "acc-shared", "r2")).runnerToken);
    const a1 = await hub.queued(a, c1.id, s1.draft.id); const a2 = await hub.queued(a, c2.id, s2.draft.id);
    const [j1, j2] = [(await claim(r1)).job!, (await claim(r2)).job!];
    const [x, y] = await Promise.all([r1.reserve(a1.id, j1.leaseToken, "acc-shared"), r2.reserve(a2.id, j2.leaseToken, "acc-shared")]);
    expect([x.data.proceed, y.data.proceed].sort()).toEqual([false, true]);
    const row = await hub.prisma.asSystem((tx) => tx.opportunityBudget.findFirstOrThrow({ where: { workspaceId: a.workspaceId, accountKey: "acc-shared" } }));
    expect(row.used).toBe(1);
  });

  it("wrong account stops the job; an existing response before the click is already_exists and costs no budget", async () => {
    const { a, s, conn, runner, account } = await setup("account");
    const att = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claim(runner)).job!;
    expect((await runner.reserve(att.id, job.leaseToken, "another-account")).data).toMatchObject({ proceed: false, reason: "wrong_account", state: "needs_user_action" });
    const s2 = await hub.scenario(a, { profile: s.profile });
    const att2 = await hub.queued(a, conn.id, s2.draft.id);
    const job2 = (await claim(runner)).job!;
    expect(job2.attemptId).toBe(att2.id);
    const exists = await runner.reserve(att2.id, job2.leaseToken, account, true);
    expect(exists.data).toMatchObject({ proceed: false, reason: "already_exists", state: "already_exists" });
    expect((await hub.attempt(a, att2.id)).data).toMatchObject({ state: "already_exists", submitReserved: false });
    expect(await hub.prisma.asSystem((tx) => tx.opportunityBudget.count({ where: { workspaceId: a.workspaceId } }))).toBe(0);
    expect((await hub.attempt(a, att2.id)).data.evidence[0].kind).toBe("baseline");
  });

  it("result rules fail closed: failure/user action after the reservation is sent_unconfirmed, never 'not sent'; unreserved uncertainty is a protocol violation", async () => {
    const { a, s, conn, runner, account } = await setup("rules");
    const att = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claim(runner)).job!;
    await runner.reserve(att.id, job.leaseToken, account);
    expect((await runner.result(att.id, job.leaseToken, "failed_before_send", [], { errorKind: "system" })).data).toMatchObject({ state: "sent_unconfirmed", accepted: false });
    expect((await hub.attempt(a, att.id)).data.state).toBe("sent_unconfirmed");

    const s2 = await hub.scenario(a, { profile: s.profile });
    const reconciled = (await hub.attempt(a, att.id)).data;
    await hub.req(`${hub.execPath(a)}/attempts/${att.id}/reconcile`, a.token, "POST", { expectedRevision: reconciled.revision, outcome: "not_sent" });
    await hub.ageSubmits(a);
    const att2 = await hub.queued(a, conn.id, s2.draft.id);
    const job2 = (await claim(runner)).job!;
    expect((await runner.result(att2.id, job2.leaseToken, "sent_unconfirmed")).data).toMatchObject({ state: "needs_user_action", accepted: false });
    expect((await hub.attempt(a, att2.id)).data.errorCode).toBe("protocol_violation");
  });

  it("three consecutive system failures pause the connection with a visible reason; platform failures do not count", async () => {
    const { a, s, conn, runner } = await setup("failures");
    const scenarios = [s, await hub.scenario(a, { profile: s.profile }), await hub.scenario(a, { profile: s.profile }), await hub.scenario(a, { profile: s.profile })];
    for (let i = 0; i < 3; i += 1) {
      const att = await hub.queued(a, conn.id, scenarios[i].draft.id);
      const job = (await claim(runner)).job!;
      expect(job.attemptId).toBe(att.id);
      const kind = i === 1 ? "platform" : "system";
      expect((await runner.result(att.id, job.leaseToken, "failed_before_send", [], { errorKind: kind, errorCode: "boom", message: "сбой" })).data.state).toBe("failed_before_send");
      if (i === 1) expect((await hub.connections(a)).data[0].consecutiveFailures).toBe(1);
    }
    const state = (await hub.connections(a)).data[0];
    expect(state.consecutiveFailures).toBe(2); expect(state.state).toBe("linked"); // платформенный сбой не считается
    const att = await hub.queued(a, conn.id, scenarios[3].draft.id);
    const job = (await claim(runner)).job!;
    await runner.result(att.id, job.leaseToken, "failed_before_send", [], { errorKind: "system" });
    const paused = (await hub.connections(a)).data[0];
    expect(paused).toMatchObject({ state: "paused", consecutiveFailures: 3 });
    expect(paused.pausedReason).toContain("системных сбоя подряд");
    expect((await claim(runner)).reason).toBe("connection_paused");
  });

  it("pairing is single-use and expiring; the token is shown once; a profile gets one live connection", async () => {
    const a = await hub.register("pairing"); await hub.enable(a, "opportunities-profiles", "opportunities-assistant", "opportunities-execution");
    const s = await hub.scenario(a);
    const conn = await hub.connection(a, s.profile.id);
    expect(conn.state).toBe("pending_link"); expect(conn.pairingCode).toMatch(/^ohp_[a-f0-9]{48}$/);
    expect((await hub.req(`${hub.execPath(a)}/connections`, a.token, "POST", { profileId: s.profile.id, accountLabel: "второй" })).status).toBe(409);
    const stored = await hub.prisma.asSystem((tx) => tx.opportunityConnection.findFirstOrThrow({ where: { id: conn.id } }));
    expect(JSON.stringify(stored)).not.toContain(conn.pairingCode); // хранится только хэш
    expect((await hub.req("/opportunities-executor/v1/bind", "", "POST", { pairingCode: "ohp_" + "0".repeat(48), externalAccountId: "x", runnerId: "r", contractVersion: "opportunities-executor/v1" })).status).toBe(401);
    const ok = await hub.bind(conn.pairingCode, "acc-pair", "runner-pair");
    expect(ok.runnerToken).toMatch(/^ohr_[a-f0-9]{48}$/);
    expect((await hub.req("/opportunities-executor/v1/bind", "", "POST", { pairingCode: conn.pairingCode, externalAccountId: "x", runnerId: "r", contractVersion: "opportunities-executor/v1" })).status).toBe(401); // код одноразовый
    const stored2 = await hub.prisma.asSystem((tx) => tx.opportunityConnection.findFirstOrThrow({ where: { id: conn.id } }));
    expect(stored2.runnerTokenHash).not.toBeNull(); expect(JSON.stringify(stored2)).not.toContain(ok.runnerToken);
    const listed = (await hub.connections(a)).data[0];
    expect(listed).toMatchObject({ state: "linked", externalAccountId: "acc-pair" });
    expect(JSON.stringify(listed)).not.toMatch(/ohr_|ohp_|Hash/);

    // просроченный код
    const a2 = await hub.register("pairing2"); await hub.enable(a2, "opportunities-profiles", "opportunities-assistant", "opportunities-execution");
    const s2 = await hub.scenario(a2); const c2 = await hub.connection(a2, s2.profile.id);
    await hub.prisma.asSystem((tx) => tx.opportunityConnection.update({ where: { id: c2.id }, data: { pairingExpiresAt: new Date(Date.now() - 1000) } }));
    expect((await hub.req("/opportunities-executor/v1/bind", "", "POST", { pairingCode: c2.pairingCode, externalAccountId: "x", runnerId: "r", contractVersion: "opportunities-executor/v1" })).status).toBe(401);
  });

  it("authorization: user JWT is not a runner token, tokens are connection-scoped, members cannot manage, revoke kills the token", async () => {
    const one = await setup("auth-a"); const two = await setup("auth-b");
    // пользовательский JWT не принимается на эндпоинтах исполнителя
    expect((await hub.req("/opportunities-executor/v1/claim", one.a.token, "POST")).status).toBe(401);
    expect((await hub.req("/opportunities-executor/v1/claim", "", "POST")).status).toBe(401);
    // токен исполнителя не принимается на человеческом API
    expect((await hub.req(`${hub.execPath(one.a)}/connections`, one.token)).status).toBe(401);
    // токен подключения A не может действовать над попыткой подключения B (чужое пространство)
    const attB = await hub.queued(two.a, two.conn.id, two.s.draft.id);
    const jobB = (await claim(two.runner)).job!;
    expect((await one.runner.heartbeat(attB.id, jobB.leaseToken)).status).toBe(409);
    expect((await one.runner.reserve(attB.id, jobB.leaseToken, one.account)).status).toBe(409);
    expect((await one.runner.result(attB.id, jobB.leaseToken, "confirmed")).status).toBe(409);
    // чужой пользователь не видит подключения и попытки
    expect((await hub.req(`${hub.execPath(two.a)}/connections`, one.a.token)).status).toBe(403);
    expect((await hub.req(`${hub.execPath(two.a)}/attempts/${attB.id}`, one.a.token)).status).toBe(403);
    // участник без роли владельца не управляет подключением
    const member = await hub.register("auth-member");
    await hub.prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: one.a.workspaceId, userId: member.userId, role: "member" } }));
    expect((await hub.req(`${hub.execPath(one.a)}/connections`, member.token)).status).toBe(403);
    expect((await hub.req(`${hub.execPath(one.a)}/connections`, member.token, "POST", { profileId: one.s.profile.id, accountLabel: "x" })).status).toBe(403);
    // отзыв: токен перестаёт работать
    const revoked = await hub.req<Connection>(`${hub.execPath(one.a)}/connections/${one.conn.id}/revoke`, one.a.token, "POST", { expectedRevision: (await hub.connections(one.a)).data[0].revision });
    expect(revoked.data.state).toBe("revoked");
    expect((await one.runner.claim()).status).toBe(401);
    // у отозванного подключения профиль может получить новое
    expect((await hub.req<CreatedConnection>(`${hub.execPath(one.a)}/connections`, one.a.token, "POST", { profileId: one.s.profile.id, accountLabel: "новое" })).status).toBe(201);
  });

  it("rights are re-checked on every runner call: removing the owner from the workspace pauses the connection and the runner is refused", async () => {
    const { a, s, conn, runner } = await setup("rights");
    await hub.queued(a, conn.id, s.draft.id);
    // владелец остаётся единственным членом; имитируем отзыв прав — снимаем роль владельца
    await hub.prisma.asSystem((tx) => tx.workspaceMember.updateMany({ where: { workspaceId: a.workspaceId, userId: a.userId }, data: { role: "member" } }));
    const refused = await runner.claim();
    expect(refused.status).toBe(403);
    const row = await hub.prisma.asSystem((tx) => tx.opportunityConnection.findFirstOrThrow({ where: { id: conn.id } }));
    expect(row).toMatchObject({ state: "paused" }); expect(row.pausedReason).toContain("Права владельца");
    await hub.prisma.asSystem((tx) => tx.workspaceMember.updateMany({ where: { workspaceId: a.workspaceId, userId: a.userId }, data: { role: "owner" } }));
  });

  it("switching the plugin off blocks the human API and the runner but keeps every record; switching it on restores access, not execution", async () => {
    const { a, s, conn, runner } = await setup("switch");
    const att = await hub.queued(a, conn.id, s.draft.id);
    expect((await hub.req(`/workspaces/${a.workspaceId}/plugins/opportunities-execution`, a.token, "PATCH", { enabled: false })).status).toBe(200);
    expect((await hub.req(`${hub.execPath(a)}/connections`, a.token)).status).toBe(409);
    expect((await runner.claim()).status).toBe(409);
    await hub.enable(a, "opportunities-execution");
    expect((await hub.attempt(a, att.id)).data).toMatchObject({ state: "canceled", grant: { state: "revoked" } });
    expect((await hub.connections(a)).data).toHaveLength(1);
    expect((await claim(runner)).job).toBeNull();
  });

  it("restore never revives external work: link and queue are cancelled, a possible send stays unconfirmed, budgets and history survive", async () => {
    const { a, s, conn, runner, account, token } = await setup("restore");
    const s2 = await hub.scenario(a, { profile: s.profile }); const s3 = await hub.scenario(a, { profile: s.profile });
    const done = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claim(runner)).job!;
    await runner.reserve(done.id, job.leaseToken, account);
    await runner.result(done.id, job.leaseToken, "confirmed", [hub.confirming(s.externalId, account)]);
    await hub.ageSubmits(a);
    const queued = await hub.queued(a, conn.id, s2.draft.id);
    const maybe = await hub.queued(a, conn.id, s3.draft.id);
    // третья «в полёте после нажатия»: имитируем состояние running + submitReserved
    const j2 = (await claim(runner)).job!;
    expect(j2.attemptId).toBe(queued.id);
    await hub.prisma.asSystem((tx) => tx.opportunityAttempt.update({ where: { id: maybe.id }, data: { state: "running", submitReserved: true, submitStartedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60000) } }));
    await hub.prisma.asSystem((tx) => tx.opportunityAttempt.update({ where: { id: queued.id }, data: { state: "queued", leaseHash: null, leaseExpiresAt: null } }));

    const service = hub.app.get(SnapshotService);
    const snapshot = await hub.prisma.withUser(a.userId, (tx) => service.serialize(tx, a.workspaceId));
    expect(JSON.stringify(snapshot)).not.toMatch(/runnerTokenHash":"[a-f0-9]{64}/); // токен-хэш не в копии? (допускается null)
    await hub.prisma.withUser(a.userId, (tx) => service.apply(tx, snapshot));

    const after = (await hub.connections(a)).data[0];
    expect(after).toMatchObject({ state: "pending_link", runnerOnline: false, consecutiveFailures: 0 });
    expect((await runner.claim()).status).toBe(401);                       // старый токен мёртв
    expect((await hub.attempt(a, done.id)).data).toMatchObject({ state: "confirmed", confirmationBasis: "runner_observed" }); // история цела
    expect((await hub.attempt(a, queued.id)).data).toMatchObject({ state: "canceled", errorCode: "restored_from_backup" });
    expect((await hub.attempt(a, maybe.id)).data).toMatchObject({ state: "sent_unconfirmed", errorCode: "restored_unconfirmed" });
    expect(await hub.prisma.asSystem((tx) => tx.opportunityGrant.count({ where: { workspaceId: a.workspaceId, state: "active" } }))).toBe(0);
    const budget = await hub.prisma.asSystem((tx) => tx.opportunityBudget.findFirstOrThrow({ where: { workspaceId: a.workspaceId } }));
    expect(budget.used).toBeGreaterThanOrEqual(1);                          // дневной счётчик не откатывается назад
    void token; void (null as unknown as Account); void (null as unknown as Attempt);
  });
});
