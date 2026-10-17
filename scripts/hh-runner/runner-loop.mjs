// Эталонный цикл локального исполнителя протокола opportunities-executor/v1.
//
// Это НЕ браузерный адаптер для hh.ru. Цикл независим от способа управления сайтом и фиксирует инварианты, которые
// обязан соблюдать любой настоящий адаптер:
//   1. нажатие («submit») выполняется не более одного раза за задание и только после `reserve` с proceed=true;
//   2. при любой неопределённости после нажатия сообщается `sent_unconfirmed`, повтор запрещён;
//   3. до резервирования любая отмена/пауза/потеря аренды прекращает работу без нажатия;
//   4. подтверждение отправляется только вместе с доказательствами, привязанными к аккаунту и вакансии.
//
// Адаптер (интерфейс):
//   observeAccount(): Promise<string>                          — id аккаунта, под которым открыт сайт сейчас
//   vacancyAlreadyApplied(externalId): Promise<{ exists: boolean, evidence?: object }>
//   prepare(payload, {signal}): Promise<{ ok: true } | { ok: false, reason: string, userAction?: boolean }>
//        открыть вакансию, выбрать резюме по id/хэшу, заполнить письмо, ПРОЧИТАТЬ значения обратно и сравнить с payload
//   submit({payload, accountId}): Promise<void> — повторная сверка аккаунта/полей и единственное нажатие без промежуточных await
//   observeConfirmation(payload, accountId): Promise<object[]> — доказательства нового события (event_id/message_id/ui_transition)
//   abort(): Promise<void>                                     — прервать до нажатия, ничего не отправляя

export const CONTRACT_VERSION = "opportunities-executor/v1";

/** @param {{api: any, adapter: any, log?: (m: string) => void, setTimer?: Function, clearTimer?: Function}} deps */
export async function runOnce({ api, adapter, log = () => undefined, setTimer = setInterval, clearTimer = clearInterval }) {
  const claim = await api.claim();
  if (!claim.job) return { status: "idle", reason: claim.reason ?? "idle", retryAfterSec: claim.retryAfterSec ?? 30 };
  const { job } = claim;
  const lease = { attemptId: job.attemptId, leaseToken: job.leaseToken };
  const state = { reserved: false, stop: null, done: false };
  const controller = new AbortController();
  let abortPromise;
  const abort = () => abortPromise ??= Promise.resolve().then(() => adapter.abort());
  let beating = false;

  // Пока нажатие не зарезервировано, любой сигнал владельца или потеря аренды — стоп. После — heartbeat только продлевает аренду.
  const beat = async () => {
    if (state.done || beating) return;
    beating = true;
    try {
      const reply = await api.heartbeat(lease.attemptId, lease.leaseToken);
      if (!state.reserved && (reply.cancelRequested || reply.paused || !reply.grantValid)) state.stop = state.stop ?? "owner_stop";
    } catch (error) {
      if (!state.reserved) state.stop = state.stop ?? "lease_lost";
      log(`heartbeat: ${error?.message ?? error}`);
    } finally {
      beating = false;
      if (state.stop && !state.reserved && !state.done) {
        controller.abort(state.stop);
        await abort().catch((error) => log(`abort: ${error?.message ?? error}`));
      }
    }
  };
  // Stop is observed while prepare is pending, not only after a slow browser operation returns.
  const timer = setTimer(() => beat(), Math.min(job.heartbeatSec ?? 15, 1) * 1000);
  const finish = (value) => { state.done = true; clearTimer(timer); return value; };
  const report = (outcome, extra = {}) => api.result(lease.attemptId, lease.leaseToken, { outcome, evidence: [], ...extra });
  const stopped = async () => {
    await abort();
    await report("needs_user_action", { errorKind: "user_action", errorCode: state.stop, message: "Остановлено до отправки." }).catch(() => undefined);
    return finish({ status: "aborted", reason: state.stop });
  };

  try {
    const externalId = job.payload.recipient.externalId;
    let accountId;
    try {
      accountId = await adapter.observeAccount();
      let baseline = await adapter.vacancyAlreadyApplied(externalId);
      if (state.stop) return await stopped();
      const prepared = baseline.exists ? { ok: true } : await adapter.prepare(job.payload, { signal: controller.signal });
      if (state.stop) return await stopped();
      if (!prepared.ok) {
        await abort();
        await report(prepared.userAction ? "needs_user_action" : "failed_before_send", { errorKind: prepared.userAction ? "user_action" : "platform", errorCode: "prepare_failed", message: prepared.reason });
        return finish({ status: "not_sent", reason: prepared.reason });
      }
      // Preparation may navigate or take minutes. Never reserve using the account observed before it.
      const currentAccount = await adapter.observeAccount();
      if (currentAccount !== accountId || (job.connection && currentAccount !== job.connection.externalAccountId)) {
        await abort();
        await report("needs_user_action", { errorKind: "user_action", errorCode: "wrong_account", message: "Аккаунт HH изменился во время подготовки. Отправка остановлена." });
        return finish({ status: "not_sent", reason: "wrong_account" });
      }
      accountId = currentAccount;
      baseline = await adapter.vacancyAlreadyApplied(externalId);
      await beat();
      if (state.stop) return await stopped();
      const reserve = await api.reserve({ ...lease, observedAccountId: accountId, baselineExists: !!baseline.exists, ...(baseline.evidence ? { baselineEvidence: baseline.evidence } : {}) });
      if (!reserve.proceed) { await abort(); return finish({ status: "not_sent", reason: reserve.reason ?? "refused", retryAfterSec: reserve.retryAfterSec }); }
      state.reserved = true;
    } catch (error) {
      // Ошибка ДО резервирования: ничего не нажато.
      try { await abort(); } catch { /* браузер мог пропасть */ }
      if (!state.reserved) {
        await report("failed_before_send", { errorKind: "system", errorCode: "runner_error", message: String(error?.message ?? error).slice(0, 400) }).catch(() => undefined);
        return finish({ status: "not_sent", reason: "error_before_reserve" });
      }
      throw error;
    }

    // Точка невозврата. Нажатие — один раз; любое исключение дальше означает «могло произойти».
    try {
      await adapter.submit({ payload: job.payload, accountId });
    } catch (error) {
      await report("sent_unconfirmed", { errorCode: "submit_threw", message: `Ошибка во время нажатия: ${String(error?.message ?? error).slice(0, 300)}` });
      return finish({ status: "unconfirmed", reason: "submit_threw" });
    }
    let evidence = [];
    try { evidence = await adapter.observeConfirmation(job.payload, accountId); }
    catch (error) {
      await report("sent_unconfirmed", { errorCode: "observe_failed", message: `Подтверждение не удалось наблюдать: ${String(error?.message ?? error).slice(0, 300)}` });
      return finish({ status: "unconfirmed", reason: "observe_failed" });
    }
    if (!evidence.length) {
      await report("sent_unconfirmed", { errorCode: "no_evidence", message: "После нажатия не найдено доказательств нового отклика." });
      return finish({ status: "unconfirmed", reason: "no_evidence" });
    }
    const reply = await report("confirmed", { evidence });
    return finish({ status: reply.accepted ? "confirmed" : "unconfirmed", reason: reply.reason });
  } catch (error) {
    // Сюда попадаем только после резервирования (например, сеть недоступна при отправке результата): нажатие считаем возможным.
    if (state.reserved) await report("sent_unconfirmed", { errorCode: "report_failed", message: String(error?.message ?? error).slice(0, 300) }).catch(() => undefined);
    return finish({ status: state.reserved ? "unconfirmed" : "not_sent", reason: "report_failed" });
  }
}
