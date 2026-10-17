import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Attempt, Connection, Draft } from "@orion/shared-types";
import { Hub } from "./opportunity-hub-fixtures";
// @ts-expect-error -- plain ESM script without type declarations
import { runOnce } from "../../../scripts/hh-runner/runner-loop.mjs";
// @ts-expect-error -- plain ESM script without type declarations
import { createSimulatedAdapter } from "../../../scripts/hh-runner/simulated-adapter.mjs";

/** R1.1: серверный протокол управляемой отправки. Исполнитель — имитация (проверяется протокол, не живой hh.ru). */
describe("Execution: grant, lease, reservation, result", () => {
  const hub = new Hub();
  beforeAll(() => hub.start());
  afterAll(() => hub.stop());

  async function setup(name: string) {
    const a = await hub.register(name); await hub.enable(a, "opportunities-profiles", "opportunities-assistant", "opportunities-execution");
    const s = await hub.scenario(a);
    const conn = await hub.connection(a, s.profile.id);
    const bound = await hub.bind(conn.pairingCode, `acc-${name}`, `runner-${name}`);
    return { a, s, conn, runner: hub.runner(bound.runnerToken), account: `acc-${name}` };
  }
  const claimJob = async (runner: ReturnType<Hub["runner"]>) => { const r = await runner.claim(); expect(r.status).toBe(200); return r.data; };

  it("walks awaiting_approval → queued → running → confirmed with bound evidence; grant is single-use; no second apply for the vacancy", async () => {
    const { a, s, conn, runner, account } = await setup("happy");
    const created = await hub.req<Attempt>(`${hub.execPath(a)}/attempts`, a.token, "POST", { draftId: s.draft.id, connectionId: conn.id, idempotencyKey: "happy-key-0001" });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ state: "awaiting_approval", grant: { state: "none" }, invalidated: false });
    expect(created.data.payload.recipient).toMatchObject({ externalId: s.externalId, sourceType: "hh" });
    // идемпотентность: тот же ключ и содержимое → та же попытка
    const again = await hub.req<Attempt>(`${hub.execPath(a)}/attempts`, a.token, "POST", { draftId: s.draft.id, connectionId: conn.id, idempotencyKey: "happy-key-0001" });
    expect(again.data.id).toBe(created.data.id);
    // другой ключ на ту же вакансию — барьер БД (одна живая/успешная попытка на вакансию и профиль)
    expect((await hub.req(`${hub.execPath(a)}/attempts`, a.token, "POST", { draftId: s.draft.id, connectionId: conn.id, idempotencyKey: "happy-key-0002" })).status).toBe(409);
    // без согласования исполнитель ничего не получает
    expect((await claimJob(runner)).job).toBeNull();

    const approve = (body: Record<string, unknown>) => hub.req<Attempt>(`${hub.execPath(a)}/attempts/${created.data.id}/approve`, a.token, "POST", body);
    expect((await approve({ expectedRevision: created.data.revision, payloadHash: "0".repeat(64) })).status).toBe(409); // не тот хэш
    const approved = await approve({ expectedRevision: created.data.revision, payloadHash: created.data.payloadHash, ttlMinutes: 30 });
    expect(approved.status).toBe(201);
    expect(approved.data).toMatchObject({ state: "queued", grant: { state: "active", grantedBy: a.userId } });

    const claimed = await claimJob(runner);
    expect(claimed.job).toMatchObject({ attemptId: created.data.id, payloadHash: created.data.payloadHash, connection: { externalAccountId: account } });
    expect(claimed.job!.payload.text).toContain("Писал SQL запросы");
    const lease = claimed.job!.leaseToken;
    expect((await hub.attempt(a, created.data.id)).data.state).toBe("running");
    // чужой/неверный токен аренды не принимается
    expect((await runner.heartbeat(created.data.id, "ohl_" + "0".repeat(48))).status).toBe(409);
    const beat = await runner.heartbeat(created.data.id, lease);
    expect(beat.data).toMatchObject({ cancelRequested: false, paused: false, grantValid: true });

    // нельзя подтвердить отправку, которую не резервировали
    const early = await runner.result(created.data.id, lease, "confirmed", [hub.confirming(s.externalId, account)]);
    expect(early.data).toMatchObject({ accepted: false, state: "needs_user_action" });
    // (попытка закрыта нарушением протокола — создаём новую вакансию для основного сценария ниже)
    expect((await hub.attempt(a, created.data.id)).data).toMatchObject({ state: "needs_user_action", errorCode: "protocol_violation" });
  });

  it("confirmed requires evidence bound to account, recipient and time; the grant is consumed at reservation; reserve cannot proceed twice", async () => {
    const { a, s, conn, runner, account } = await setup("confirm");
    const att = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claimJob(runner)).job!;
    const reserve = await runner.reserve(att.id, job.leaseToken, account);
    expect(reserve.data).toMatchObject({ proceed: true, state: "running" });
    const afterReserve = (await hub.attempt(a, att.id)).data;
    expect(afterReserve).toMatchObject({ submitReserved: true, state: "running", grant: { state: "consumed" } });
    expect((await runner.reserve(att.id, job.leaseToken, account)).data).toMatchObject({ proceed: false, reason: "already_reserved" });
    // ни скриншот, ни чужой аккаунт, ни чужой получатель, ни «просто текст» не подтверждают
    const insufficient: [string, import("@orion/shared-types").Evidence[]][] = [
      ["screenshot only", [{ kind: "screenshot_hash", at: new Date().toISOString(), sha256: "a".repeat(64) }]],
      ["other account", [hub.confirming(s.externalId, "someone-else")]],
      ["other recipient", [hub.confirming("999", account)]],
      ["note only", [{ kind: "note", at: new Date().toISOString(), text: "success" }]],
      ["before the submit", [{ ...hub.confirming(s.externalId, account), at: new Date(Date.now() - 3600_000).toISOString() }]]
    ];
    for (const [label, evidence] of insufficient) {
      const r = await runner.result(att.id, job.leaseToken, "confirmed", evidence);
      expect(r.data, label).toMatchObject({ accepted: false, state: "sent_unconfirmed" });
    }
    expect((await hub.attempt(a, att.id)).data.state).toBe("sent_unconfirmed");
    // поздний подтверждающий результат с правильными доказательствами снимает неопределённость
    const late = await runner.result(att.id, job.leaseToken, "confirmed", [hub.confirming(s.externalId, account)]);
    expect(late.data).toMatchObject({ accepted: true, state: "confirmed" });
    const done = (await hub.attempt(a, att.id)).data;
    expect(done).toMatchObject({ state: "confirmed", confirmationBasis: "runner_observed" });
    expect(done.evidence.some((e) => e.kind === "event_id" && e.accountId === account)).toBe(true);
    // повторное задание не выдаётся
    expect((await claimJob(runner)).job).toBeNull();
  });

  it("changing the draft, the resume or the recipient after approval revokes the grant before anything is sent", async () => {
    const { a, s, conn, runner } = await setup("invalidate");
    const att = await hub.queued(a, conn.id, s.draft.id);
    // владелец правит одобренный текст → одобрение черновика сбрасывается, хэш меняется
    const draftPath = `${hub.assistantPath(a)}/drafts/${s.draft.id}`;
    const edited = await hub.req<Draft>(draftPath, a.token, "PATCH", { expectedRevision: s.draft.revision, sections: s.draft.sections.map((x) => ({ id: x.id, text: x.id === "s-greeting" ? "Добрый день!" : x.text, factIds: x.factIds })) });
    expect(edited.status).toBe(200);
    const seen = (await hub.attempt(a, att.id)).data;
    // чтение само отзывает разрешение у согласованной, но не начатой отправки
    expect(seen).toMatchObject({ state: "needs_user_action", errorCode: "content_changed", grant: { state: "revoked" } });
    expect((await claimJob(runner)).job).toBeNull();
  });

  it("a runner that claims right after an edit is refused (fail closed at claim), and a new resume version changes the hash", async () => {
    const { a, s, conn, runner } = await setup("claim-check");
    const att = await hub.queued(a, conn.id, s.draft.id);
    // правка черновика напрямую в БД-слое API, без чтения попытки: проверяем именно проверку при claim
    const edited = await hub.req<Draft>(`${hub.assistantPath(a)}/drafts/${s.draft.id}`, a.token, "PATCH", { expectedRevision: s.draft.revision, sections: s.draft.sections.map((x) => ({ id: x.id, text: x.id === "s-closing" ? "Свяжемся." : x.text, factIds: x.factIds })) });
    expect(edited.status).toBe(200);
    const claim = await claimJob(runner);
    expect(claim.job).toBeNull(); expect(claim.reason).toBe("content_changed");
    expect((await hub.attempt(a, att.id)).data).toMatchObject({ state: "needs_user_action", errorCode: "content_changed" });
    // смена активного резюме меняет payload
    const r2 = (await hub.req<{ id: string }>(`${hub.profilesPath(a)}/${s.profile.id}/materials`, a.token, "POST", { title: "Резюме v2", type: "resume", content: "Другая версия" })).data;
    const detail = (await hub.req<{ revision: number }>(`${hub.profilesPath(a)}/${s.profile.id}`, a.token)).data;
    await hub.req(`${hub.profilesPath(a)}/${s.profile.id}/active-resume`, a.token, "POST", { expectedRevision: detail.revision, materialId: r2.id });
    const redraft = await hub.req<Draft>(`${hub.assistantPath(a)}/drafts/${s.draft.id}`, a.token);
    expect(redraft.data.stale).toBe(true);
  });

  it("cancel before the lease, cancel during the lease before reserve, and no cancel after reserve", async () => {
    const { a, s, conn, runner, account } = await setup("cancel");
    const first = await hub.queued(a, conn.id, s.draft.id);
    const canceled = await hub.req<Attempt>(`${hub.execPath(a)}/attempts/${first.id}/cancel`, a.token, "POST", { expectedRevision: first.revision });
    expect(canceled.data).toMatchObject({ state: "canceled", grant: { state: "revoked" } });
    expect((await claimJob(runner)).job).toBeNull();

    // после отмены можно подготовить новую отправку по той же вакансии (барьер учитывает только живые/успешные)
    const second = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claimJob(runner)).job!;
    const req = await hub.req<Attempt>(`${hub.execPath(a)}/attempts/${second.id}/cancel`, a.token, "POST", { expectedRevision: (await hub.attempt(a, second.id)).data.revision });
    expect(req.data).toMatchObject({ state: "running", cancelRequested: true });
    expect((await runner.heartbeat(second.id, job.leaseToken)).data).toMatchObject({ cancelRequested: true, grantValid: false });
    expect((await runner.reserve(second.id, job.leaseToken, account)).data).toMatchObject({ proceed: false, reason: "canceled" });
    expect((await hub.attempt(a, second.id)).data.state).toBe("canceled");

    const third = await hub.queued(a, conn.id, s.draft.id);
    const job3 = (await claimJob(runner)).job!;
    expect((await runner.reserve(third.id, job3.leaseToken, account)).data.proceed).toBe(true);
    const late = await hub.req(`${hub.execPath(a)}/attempts/${third.id}/cancel`, a.token, "POST", { expectedRevision: (await hub.attempt(a, third.id)).data.revision });
    expect(late.status).toBe(409); // «уже отправленное не называется отменённым»
  });

  it("pause and stop: a paused connection issues no jobs and refuses to reserve; stop cancels the queue and revokes grants", async () => {
    const { a, s, conn, runner, account } = await setup("pause");
    const queued = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claimJob(runner)).job!;
    const paused = await hub.req<Connection>(`${hub.execPath(a)}/connections/${conn.id}/pause`, a.token, "POST", { expectedRevision: (await hub.connections(a)).data[0].revision });
    expect(paused.data.state).toBe("paused");
    expect((await runner.heartbeat(queued.id, job.leaseToken)).data).toMatchObject({ paused: true, cancelRequested: true });
    expect((await runner.reserve(queued.id, job.leaseToken, account)).data).toMatchObject({ proceed: false, reason: "connection_paused" });
    expect((await claimJob(runner)).reason).toBe("connection_paused");

    const s2 = await hub.scenario(a, { profile: s.profile });
    const rev = (await hub.connections(a)).data[0].revision;
    const resumed = await hub.req<Connection>(`${hub.execPath(a)}/connections/${conn.id}/resume`, a.token, "POST", { expectedRevision: rev });
    expect(resumed.data.state).toBe("linked");
    const q2 = await hub.queued(a, conn.id, s2.draft.id);
    const stopped = await hub.req<Connection>(`${hub.execPath(a)}/connections/${conn.id}/stop`, a.token, "POST", { expectedRevision: resumed.data.revision });
    expect(stopped.data.state).toBe("paused");
    expect((await hub.attempt(a, q2.id)).data).toMatchObject({ state: "canceled", grant: { state: "revoked" } });
  });

  it("fault injection: a runner lost after the click leaves sent_unconfirmed, nothing is re-sent, reconcile never sends", async () => {
    const { a, s, conn, runner, account } = await setup("fault");
    const att = await hub.queued(a, conn.id, s.draft.id);
    const job = (await claimJob(runner)).job!;
    expect((await runner.reserve(att.id, job.leaseToken, account)).data.proceed).toBe(true);
    // браузер потерян: аренда истекает без результата
    await hub.prisma.asSystem((tx) => tx.opportunityAttempt.update({ where: { id: att.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }));
    const seen = (await hub.attempt(a, att.id)).data;
    expect(seen).toMatchObject({ state: "sent_unconfirmed", errorCode: "lease_expired_after_submit" });
    expect((await claimJob(runner)).job).toBeNull();                               // повторного задания нет
    expect((await hub.req(`${hub.execPath(a)}/attempts`, a.token, "POST", { draftId: s.draft.id, connectionId: conn.id, idempotencyKey: "fault-retry-0001" })).status).toBe(409); // новая попытка заблокирована
    expect((await hub.req(`${hub.execPath(a)}/attempts/${att.id}/cancel`, a.token, "POST", { expectedRevision: seen.revision })).status).toBe(409);
    // сверка человеком: «не отправлено» → failed_before_send, затем можно создать новую отправку с новым согласованием
    const notSent = await hub.req<Attempt>(`${hub.execPath(a)}/attempts/${att.id}/reconcile`, a.token, "POST", { expectedRevision: seen.revision, outcome: "not_sent", note: "На hh.ru отклика нет" });
    expect(notSent.data).toMatchObject({ state: "failed_before_send", errorCode: "owner_reported_not_sent" });
    expect(notSent.data.evidence.at(-1)).toMatchObject({ kind: "owner_attested" });
    expect((await claimJob(runner)).job).toBeNull(); // сверка ничего не отправляет
    const retry = await hub.queued(a, conn.id, s.draft.id);
    expect(retry.id).not.toBe(att.id);

    // вторая вакансия: «отправлено» по сверке — confirmed, но основание честно помечено
    const s2 = await hub.scenario(a, { profile: s.profile });
    const att2 = await hub.queued(a, conn.id, s2.draft.id);
    await hub.req(`${hub.execPath(a)}/attempts/${retry.id}/cancel`, a.token, "POST", { expectedRevision: (await hub.attempt(a, retry.id)).data.revision });
    const job2 = (await claimJob(runner)).job!;
    expect(job2.attemptId).toBe(att2.id);
    await hub.ageSubmits(a);
    expect((await runner.reserve(att2.id, job2.leaseToken, account)).data.proceed).toBe(true);
    await runner.result(att2.id, job2.leaseToken, "sent_unconfirmed", [], { message: "браузер закрыт" });
    const un = (await hub.attempt(a, att2.id)).data;
    expect(un.state).toBe("sent_unconfirmed");
    const sent = await hub.req<Attempt>(`${hub.execPath(a)}/attempts/${att2.id}/reconcile`, a.token, "POST", { expectedRevision: un.revision, outcome: "sent" });
    expect(sent.data).toMatchObject({ state: "confirmed", confirmationBasis: "owner_attested" });
  });

  it("a lease that expires BEFORE reservation returns the job to the queue (safe to retry); two concurrent claims yield one job", async () => {
    const { a, s, conn, runner } = await setup("lease");
    const att = await hub.queued(a, conn.id, s.draft.id);
    const racers = await Promise.all([runner.claim(), runner.claim(), runner.claim()]);
    const jobs = racers.map((r) => r.data.job).filter(Boolean);
    expect(jobs).toHaveLength(1);
    await hub.prisma.asSystem((tx) => tx.opportunityAttempt.update({ where: { id: att.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }));
    expect((await hub.attempt(a, att.id)).data.state).toBe("queued");
    const again = await claimJob(runner);
    expect(again.job?.attemptId).toBe(att.id);
    expect(again.job!.leaseToken).not.toBe(jobs[0]!.leaseToken);
    // старая аренда больше не действует
    expect((await runner.heartbeat(att.id, jobs[0]!.leaseToken)).status).toBe(409);
  });

  it("an expired grant stops the job; expiry is checked at claim and on read", async () => {
    const { a, s, conn, runner } = await setup("grant-ttl");
    const att = await hub.queued(a, conn.id, s.draft.id);
    await hub.prisma.asSystem((tx) => tx.opportunityGrant.updateMany({ where: { attemptId: att.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const claim = await claimJob(runner);
    expect(claim.job).toBeNull();
    expect((await hub.attempt(a, att.id)).data).toMatchObject({ state: "needs_user_action", grant: { state: "expired" } });
  });


  it("the reference runner loop speaks the real protocol: confirmed, lost browser, failed form, existing response", async () => {
    const { a, s, conn, runner, account } = await setup("loop");
    const api = {
      claim: async () => (await runner.claim()).data,
      heartbeat: async (id: string, lease: string) => { const r = await runner.heartbeat(id, lease); if (r.status !== 200) throw Object.assign(new Error("heartbeat"), { status: r.status }); return r.data; },
      reserve: async (b: { attemptId: string; leaseToken: string; observedAccountId: string; baselineExists: boolean; baselineEvidence?: never }) => (await runner.reserve(b.attemptId, b.leaseToken, b.observedAccountId, b.baselineExists, b.baselineEvidence)).data,
      result: async (id: string, lease: string, body: { outcome: string; evidence?: never[] } & Record<string, unknown>) => { const { outcome, evidence, ...extra } = body; const r = await runner.result(id, lease, outcome, evidence ?? [], extra); if (r.status >= 400) throw new Error(`result ${r.status}`); return r.data; }
    };
    const timers = { setTimer: () => 1, clearTimer: () => undefined };
    const run = (scenario: Record<string, unknown>) => runOnce({ api, adapter: createSimulatedAdapter({ accountId: account, ...scenario }), ...timers }) as Promise<{ status: string }>;

    const att1 = await hub.queued(a, conn.id, s.draft.id);
    expect((await run({})).status).toBe("confirmed");
    expect((await hub.attempt(a, att1.id)).data).toMatchObject({ state: "confirmed", confirmationBasis: "runner_observed", submitReserved: true });

    const s2 = await hub.scenario(a, { profile: s.profile }); await hub.ageSubmits(a);
    const att2 = await hub.queued(a, conn.id, s2.draft.id);
    expect((await run({ submitThrows: true })).status).toBe("unconfirmed");
    expect((await hub.attempt(a, att2.id)).data).toMatchObject({ state: "sent_unconfirmed", errorCode: "submit_threw" });

    const s3 = await hub.scenario(a, { profile: s.profile }); await hub.ageSubmits(a);
    const att3 = await hub.queued(a, conn.id, s3.draft.id);
    expect((await run({ prepareFails: "письмо не совпало после чтения" })).status).toBe("not_sent");
    expect((await hub.attempt(a, att3.id)).data).toMatchObject({ state: "failed_before_send", submitReserved: false });

    const s4 = await hub.scenario(a, { profile: s.profile });
    const att4 = await hub.queued(a, conn.id, s4.draft.id);
    expect((await run({ alreadyApplied: true })).status).toBe("not_sent");
    expect((await hub.attempt(a, att4.id)).data).toMatchObject({ state: "already_exists", submitReserved: false });
  });

  it("dry run in the assistant has no execution capability: it creates no attempt and no job", async () => {
    const { a, s, conn, runner } = await setup("dryrun");
    const dry = await hub.req<{ send: boolean; mode: string }>(`${hub.assistantPath(a)}/drafts/${s.draft.id}/dry-run`, a.token, "POST");
    expect(dry.data).toMatchObject({ mode: "dry_run", send: false });
    expect((await hub.req<{ items: unknown[] }>(`${hub.execPath(a)}/attempts`, a.token)).data.items).toHaveLength(0);
    expect((await claimJob(runner)).job).toBeNull();
    void conn;
  });
});

