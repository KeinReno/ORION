import { describe, expect, it } from "vitest";
import { runOnce } from "./runner-loop.mjs";
import { createSimulatedAdapter } from "./simulated-adapter.mjs";

const job = { attemptId: "a1", leaseToken: "ohl_x", heartbeatSec: 15, payload: { recipient: { externalId: "777" }, text: "Текст" } };

function fakeApi({ claim = { job }, reserve = { proceed: true }, heartbeat = { cancelRequested: false, paused: false, grantValid: true, leaseExpiresAt: "" }, resultReply = { accepted: true, state: "confirmed" } } = {}) {
  const calls = [];
  return {
    calls,
    async claim() { calls.push(["claim"]); return claim; },
    async heartbeat() { calls.push(["heartbeat"]); if (heartbeat instanceof Error) throw heartbeat; return heartbeat; },
    async reserve(body) { calls.push(["reserve", body]); return reserve; },
    async result(_a, _l, body) { calls.push(["result", body]); return resultReply; }
  };
}
const names = (api) => api.calls.map((c) => c[0]);
const results = (api) => api.calls.filter((c) => c[0] === "result").map((c) => c[1]);
const timers = () => ({ setTimer: () => 1, clearTimer: () => undefined });

describe("runner loop invariants", () => {
  it("rechecks the account after preparation and never reserves or clicks after a switch", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter();
    let observations = 0;
    const switched = { ...adapter, async observeAccount() { return ++observations === 1 ? "acc-sim" : "other-account"; } };
    expect(await runOnce({ api, adapter: switched, ...timers() })).toMatchObject({ status: "not_sent", reason: "wrong_account" });
    expect(names(api)).not.toContain("reserve"); expect(adapter.calls).not.toContain("submit");
    expect(results(api)[0]).toMatchObject({ outcome: "needs_user_action", errorCode: "wrong_account" });
  });

  it("polls stop at one second and interrupts a pending preparation immediately", async () => {
    const api = fakeApi({ heartbeat: { cancelRequested: true, paused: true, grantValid: false } });
    const adapter = createSimulatedAdapter(); let tick; let interval;
    const slow = { ...adapter, async prepare(_payload, { signal }) {
      const interrupted = new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      await tick(); await interrupted;
      expect(adapter.calls).toContain("abort");
      return { ok: true };
    } };
    expect(await runOnce({ api, adapter: slow, setTimer: (fn, ms) => { tick = fn; interval = ms; return 1; }, clearTimer: () => undefined })).toMatchObject({ status: "aborted" });
    expect(interval).toBe(1000); expect(adapter.calls).not.toContain("submit");
    expect(results(api)[0]).toMatchObject({ outcome: "needs_user_action", errorCode: "owner_stop" });
  });

  it("happy path: reserve before submit, exactly one submit, confirmed with bound evidence", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter();
    const out = await runOnce({ api, adapter, ...timers() });
    expect(out.status).toBe("confirmed");
    expect(adapter.calls.filter((c) => c === "submit")).toHaveLength(1);
    expect(names(api).indexOf("reserve")).toBeLessThan(adapter.calls.indexOf("submit") + 100);
    expect(adapter.calls.indexOf("prepare")).toBeLessThan(adapter.calls.indexOf("submit"));
    const [report] = results(api);
    expect(report).toMatchObject({ outcome: "confirmed" });
    expect(report.evidence[0]).toMatchObject({ kind: "event_id", accountId: "acc-sim", recipientExternalId: "777" });
    expect(api.calls.find((c) => c[0] === "reserve")[1]).toMatchObject({ observedAccountId: "acc-sim", baselineExists: false });
  });

  it("idle when there is no job; nothing else is called", async () => {
    const api = fakeApi({ claim: { job: null, reason: "daily_limit", retryAfterSec: 600 } }); const adapter = createSimulatedAdapter();
    expect(await runOnce({ api, adapter, ...timers() })).toMatchObject({ status: "idle", reason: "daily_limit", retryAfterSec: 600 });
    expect(adapter.calls).toEqual([]);
  });

  it("a refused reservation never reaches submit", async () => {
    for (const reason of ["min_interval", "daily_limit", "wrong_account", "grant_invalid", "canceled"]) {
      const api = fakeApi({ reserve: { proceed: false, reason, retryAfterSec: 60 } }); const adapter = createSimulatedAdapter();
      expect(await runOnce({ api, adapter, ...timers() })).toMatchObject({ status: "not_sent", reason });
      expect(adapter.calls).not.toContain("submit"); expect(adapter.calls).toContain("abort"); expect(results(api)).toEqual([]);
    }
  });

  it("an existing response is reported to the server before any click", async () => {
    const api = fakeApi({ reserve: { proceed: false, reason: "already_exists" } }); const adapter = createSimulatedAdapter({ alreadyApplied: true });
    await runOnce({ api, adapter, ...timers() });
    expect(api.calls.find((c) => c[0] === "reserve")[1].baselineExists).toBe(true);
    expect(adapter.calls).not.toContain("submit");
  });

  it("a form that cannot be prepared or read back is reported as not sent and never reserved", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter({ prepareFails: "письмо не совпало после чтения" });
    expect((await runOnce({ api, adapter, ...timers() })).status).toBe("not_sent");
    expect(names(api)).not.toContain("reserve"); expect(adapter.calls).not.toContain("submit");
    expect(results(api)[0]).toMatchObject({ outcome: "failed_before_send", errorCode: "prepare_failed" });
  });

  it("losing the browser DURING the click is unconfirmed and is never retried", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter({ submitThrows: true });
    expect((await runOnce({ api, adapter, ...timers() })).status).toBe("unconfirmed");
    expect(adapter.calls.filter((c) => c === "submit")).toHaveLength(1);
    expect(results(api)).toEqual([expect.objectContaining({ outcome: "sent_unconfirmed", errorCode: "submit_threw" })]);
  });

  it("no evidence or an unobservable page after the click is unconfirmed, not a success", async () => {
    for (const scenario of [{ noEvidence: true }, { observeFails: true }]) {
      const api = fakeApi(); const adapter = createSimulatedAdapter(scenario);
      expect((await runOnce({ api, adapter, ...timers() })).status).toBe("unconfirmed");
      expect(results(api)[0].outcome).toBe("sent_unconfirmed");
      expect(results(api)).toHaveLength(1);
    }
  });

  it("when the server rejects a confirmation the loop does not claim success", async () => {
    const api = fakeApi({ resultReply: { accepted: false, state: "sent_unconfirmed", reason: "evidence_insufficient" } });
    expect((await runOnce({ api, adapter: createSimulatedAdapter(), ...timers() })).status).toBe("unconfirmed");
  });

  it("an owner stop seen through the heartbeat before the reservation aborts without a click", async () => {
    const api = fakeApi({ heartbeat: { cancelRequested: true, paused: false, grantValid: false } });
    const adapter = createSimulatedAdapter();
    let tick = () => undefined;
    const slow = { ...adapter, async prepare() { await tick(); return { ok: true }; } };
    const out = await runOnce({ api, adapter: slow, setTimer: (fn) => { tick = async () => { await fn(); await Promise.resolve(); }; return 1; }, clearTimer: () => undefined });
    expect(out).toMatchObject({ status: "aborted", reason: "owner_stop" });
    expect(adapter.calls).not.toContain("submit"); expect(names(api)).not.toContain("reserve");
  });

  it("a lost lease before the reservation aborts without a click", async () => {
    const api = fakeApi({ heartbeat: Object.assign(new Error("lease_expired"), { status: 409 }) });
    const adapter = createSimulatedAdapter();
    let tick = () => undefined;
    const slow = { ...adapter, async prepare() { await tick(); return { ok: true }; } };
    const out = await runOnce({ api, adapter: slow, setTimer: (fn) => { tick = async () => { await fn(); await Promise.resolve(); }; return 1; }, clearTimer: () => undefined });
    expect(out).toMatchObject({ status: "aborted", reason: "lease_lost" });
    expect(adapter.calls).not.toContain("submit");
  });

  it("network failure while reporting after the click: unconfirmed, no second click, the server's lease expiry settles it", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter();
    api.result = async (_a, _l, body) => { api.calls.push(["result", body]); throw new Error("ECONNRESET"); };
    const out = await runOnce({ api, adapter, ...timers() });
    expect(out.status).toBe("unconfirmed");
    expect(adapter.calls.filter((c) => c === "submit")).toHaveLength(1);
    expect(results(api).map((r) => r.outcome)).toEqual(["confirmed", "sent_unconfirmed"]);
  });

  it("network failure at the reservation (before the click) never clicks", async () => {
    const api = fakeApi(); const adapter = createSimulatedAdapter();
    api.reserve = async () => { api.calls.push(["reserve"]); throw new Error("ECONNRESET"); };
    const out = await runOnce({ api, adapter, ...timers() });
    expect(out.status).toBe("not_sent");
    expect(adapter.calls).not.toContain("submit");
  });

  it("an adapter crash before the reservation is a system failure, not a send", async () => {
    const api = fakeApi(); const adapter = { ...createSimulatedAdapter(), async observeAccount() { throw new Error("CDP недоступен"); } };
    expect((await runOnce({ api, adapter, ...timers() })).status).toBe("not_sent");
    expect(results(api)[0]).toMatchObject({ outcome: "failed_before_send", errorKind: "system" });
    expect(names(api)).not.toContain("reserve");
  });
});
