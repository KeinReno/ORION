import { describe, expect, it } from "vitest";
import type { Evidence } from "@orion/shared-types";
import { decideOutcome, evidenceConfirmsSend, hhRecipientProblem, localDateKey, newSecret, secondsToLocalMidnight, sha256 } from "./exec-core";
import { SlidingWindow } from "./runner-auth.guard";

const at = new Date("2026-10-15T10:00:00.000Z");
const ctx = { submitReserved: true, submitStartedAt: at, accountId: "acc", recipientExternalId: "123", currentState: "running" as const };
const proof = (patch: Partial<Evidence> = {}): Evidence => ({ kind: "event_id", at: new Date(at.getTime() + 2000).toISOString(), accountId: "acc", recipientExternalId: "123", ref: "n-1", ...patch });

describe("exec-core: outcomes fail closed", () => {
  it("confirmed needs a confirming proof bound to account, recipient and time", () => {
    expect(evidenceConfirmsSend([proof()], { accountId: "acc", recipientExternalId: "123", submitStartedAt: at })).toBe(true);
    for (const bad of [proof({ kind: "screenshot_hash" }), proof({ kind: "note" }), proof({ accountId: "other" }), proof({ recipientExternalId: "999" }), proof({ at: new Date(at.getTime() - 60_000).toISOString() }), proof({ accountId: undefined })]) {
      expect(evidenceConfirmsSend([bad], { accountId: "acc", recipientExternalId: "123", submitStartedAt: at })).toBe(false);
    }
    for (const bad of [proof({ ref: undefined }), proof({ ref: " " }), proof({ at: new Date(at.getTime() - 1).toISOString() }), proof({ at: "2099-01-01T00:00:00.000Z" })]) {
      expect(evidenceConfirmsSend([bad], ctx)).toBe(false);
    }
  });
  it("decides every outcome without ever calling an uncertain result 'not sent'", () => {
    expect(decideOutcome({ outcome: "confirmed", evidence: [proof()] }, ctx)).toMatchObject({ state: "confirmed", basis: "runner_observed", accepted: true });
    expect(decideOutcome({ outcome: "confirmed", evidence: [] }, ctx)).toMatchObject({ state: "sent_unconfirmed", accepted: false });
    expect(decideOutcome({ outcome: "confirmed", evidence: [proof()] }, { ...ctx, submitReserved: false, submitStartedAt: null })).toMatchObject({ state: "needs_user_action", accepted: false });
    expect(decideOutcome({ outcome: "failed_before_send", evidence: [], errorKind: "system" }, ctx).state).toBe("sent_unconfirmed");
    expect(decideOutcome({ outcome: "failed_before_send", evidence: [], errorKind: "system" }, { ...ctx, submitReserved: false, submitStartedAt: null })).toMatchObject({ state: "failed_before_send", systemFailure: true });
    expect(decideOutcome({ outcome: "failed_before_send", evidence: [], errorKind: "platform" }, { ...ctx, submitReserved: false, submitStartedAt: null }).systemFailure).toBe(false);
    expect(decideOutcome({ outcome: "needs_user_action", evidence: [] }, ctx).state).toBe("sent_unconfirmed");
    expect(decideOutcome({ outcome: "needs_user_action", evidence: [] }, { ...ctx, submitReserved: false, submitStartedAt: null }).state).toBe("needs_user_action");
    expect(decideOutcome({ outcome: "already_exists", evidence: [] }, ctx).state).toBe("sent_unconfirmed");
    expect(decideOutcome({ outcome: "already_exists", evidence: [] }, { ...ctx, submitReserved: false, submitStartedAt: null }).state).toBe("already_exists");
    expect(decideOutcome({ outcome: "sent_unconfirmed", evidence: [] }, ctx)).toMatchObject({ state: "sent_unconfirmed", accepted: true });
    expect(decideOutcome({ outcome: "sent_unconfirmed", evidence: [] }, { ...ctx, submitReserved: false, submitStartedAt: null })).toMatchObject({ state: "needs_user_action", accepted: false });
  });
});

describe("exec-core: recipient, dates, secrets, limiter", () => {
  it("only an hh.ru vacancy with a numeric id matching the link is a valid recipient", () => {
    const ok = { sourceType: "hh", externalId: "12345", url: "https://hh.ru/vacancy/12345" };
    expect(hhRecipientProblem(ok)).toBeNull();
    expect(hhRecipientProblem({ ...ok, url: "https://spb.hh.ru/vacancy/12345?x=1" })).toBeNull();
    for (const bad of [{ ...ok, sourceType: "manual" }, { ...ok, externalId: null }, { ...ok, externalId: "abc" }, { ...ok, url: null }, { ...ok, url: "http://hh.ru/vacancy/12345" }, { ...ok, url: "https://hh.ru.evil.test/vacancy/12345" }, { ...ok, url: "https://user:pw@hh.ru/vacancy/12345" }, { ...ok, url: "https://hh.ru/vacancy/99999" }]) {
      expect(hhRecipientProblem(bad), JSON.stringify(bad)).not.toBeNull();
    }
  });
  it("the daily key follows the connection's time zone, and midnight is ahead", () => {
    const instant = new Date("2026-10-15T21:30:00.000Z");
    expect(localDateKey(instant, "Europe/Moscow")).toBe("2026-10-16");
    expect(localDateKey(instant, "UTC")).toBe("2026-10-15");
    const left = secondsToLocalMidnight(instant, "Europe/Moscow");
    expect(left).toBeGreaterThan(60); expect(left).toBeLessThanOrEqual(86400);
    expect(localDateKey(new Date(instant.getTime() + left * 1000), "Europe/Moscow")).toBe("2026-10-17");
  });
  it("secrets are prefixed, random and stored only as hashes", () => {
    const a = newSecret("ohr"); const b = newSecret("ohr");
    expect(a.secret).toMatch(/^ohr_[a-f0-9]{48}$/); expect(a.secret).not.toBe(b.secret); expect(a.hash).toBe(sha256(a.secret)); expect(a.hash).not.toContain(a.secret);
  });
  it("the sliding window blocks after the limit and recovers; a function limit is read each time", () => {
    let now = 0; let limit = 2; const w = new SlidingWindow(() => limit, 1000, () => now);
    expect([w.consume("k"), w.consume("k"), w.consume("k")]).toEqual([true, true, false]);
    now = 1500; expect(w.consume("k")).toBe(true);
    limit = 1; expect(w.consume("k")).toBe(false);
  });
});
