import { describe, expect, it } from "vitest";
import { describeReadinessFailure, pollReadiness } from "./readiness.mjs";

/** A controlled fake clock: `now()` only advances when `sleep()` is awaited,
 * so the test resolves instantly instead of waiting on real timers. */
function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    }
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("pollReadiness", () => {
  it("returns ready as soon as /system/health answers ok", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = async () => jsonResponse(200, { status: "ok", database: "ok" });
    const result = await pollReadiness({ url: "http://x/system/health", fetchImpl, now, sleep, deadlineMs: 10_000 });
    expect(result).toEqual({ state: "ready", body: { status: "ok", database: "ok" } });
  });

  it("keeps polling through connection-refused errors until the service comes up", async () => {
    const { now, sleep } = fakeClock();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls < 3) throw new Error("ECONNREFUSED");
      return jsonResponse(200, { status: "ok" });
    };
    const result = await pollReadiness({
      url: "http://x/system/health",
      fetchImpl,
      now,
      sleep,
      deadlineMs: 10_000,
      pollIntervalMs: 100
    });
    expect(result.state).toBe("ready");
    expect(calls).toBe(3);
  });

  it("reports wrong-service when something else answers the port (занят порт)", async () => {
    const { now, sleep } = fakeClock();
    // A foreign HTTP server on the same port — 200 OK, but not our health shape.
    const fetchImpl = async () => jsonResponse(200, { hello: "world" });
    const result = await pollReadiness({ url: "http://x/system/health", fetchImpl, now, sleep, deadlineMs: 10_000 });
    expect(result).toEqual({ state: "wrong-service", status: 200 });
  });

  it("reports wrong-service on a non-2xx response (e.g. a foreign service's 404)", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = async () => jsonResponse(404, {});
    const result = await pollReadiness({ url: "http://x/system/health", fetchImpl, now, sleep, deadlineMs: 10_000 });
    expect(result).toEqual({ state: "wrong-service", status: 404 });
  });

  it("reports crashed immediately once the child process has exited, without waiting out the deadline", async () => {
    const { now, sleep } = fakeClock();
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      throw new Error("ECONNREFUSED");
    };
    const result = await pollReadiness({
      url: "http://x/system/health",
      fetchImpl,
      now,
      sleep,
      deadlineMs: 10_000,
      isCrashed: () => true
    });
    expect(result).toEqual({ state: "crashed" });
    expect(fetchCalls).toBe(0);
  });

  it("reports timeout when the deadline passes with the service never answering (БД не поднялась)", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await pollReadiness({
      url: "http://x/system/health",
      fetchImpl,
      now,
      sleep,
      deadlineMs: 1_000,
      pollIntervalMs: 400
    });
    expect(result.state).toBe("timeout");
  });
});

describe("describeReadinessFailure", () => {
  it("names the crashed service and hints at common causes", () => {
    const msg = describeReadinessFailure({ state: "crashed" }, { name: "API", port: 4000, logTail: "Error: P1001" });
    expect(msg).toContain("API");
    expect(msg).toContain("4000");
    expect(msg).toContain("Error: P1001");
  });

  it("names the port for a wrong-service occupant", () => {
    const msg = describeReadinessFailure({ state: "wrong-service", status: 200 }, { name: "API", port: 4000 });
    expect(msg).toContain("4000");
    expect(msg.toLowerCase()).toContain("не похоже");
  });

  it("mentions Postgres for a timeout", () => {
    const msg = describeReadinessFailure({ state: "timeout" }, { name: "API", port: 4000 });
    expect(msg).toContain("Postgres");
  });
});
