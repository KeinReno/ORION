// Имитация браузерного адаптера для проверки протокола. Никакого сайта, сети и браузера: только сценарии исходов.

/** @param {{accountId?: string, alreadyApplied?: boolean, prepareFails?: string|null, submitThrows?: boolean, observeFails?: boolean, noEvidence?: boolean}} [scenario] */
export function createSimulatedAdapter(scenario = {}) {
  const calls = [];
  const accountId = scenario.accountId ?? "acc-sim";
  return {
    calls,
    async observeAccount() { calls.push("observeAccount"); return accountId; },
    async vacancyAlreadyApplied() { calls.push("vacancyAlreadyApplied"); return { exists: !!scenario.alreadyApplied }; },
    async prepare() { calls.push("prepare"); return scenario.prepareFails ? { ok: false, reason: scenario.prepareFails } : { ok: true }; },
    async submit() { calls.push("submit"); if (scenario.submitThrows) throw new Error("браузер закрыт"); },
    async observeConfirmation(payload) {
      calls.push("observeConfirmation");
      if (scenario.observeFails) throw new Error("страница недоступна");
      if (scenario.noEvidence) return [];
      return [{ kind: "event_id", at: new Date().toISOString(), accountId, recipientExternalId: payload.recipient.externalId, ref: "sim-negotiation" }];
    },
    async abort() { calls.push("abort"); }
  };
}
