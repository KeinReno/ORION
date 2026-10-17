import { createHash, randomBytes } from "node:crypto";
import { CONFIRMING_EVIDENCE_KINDS, type AttemptState, type Evidence, type RunnerResultInput } from "@orion/shared-types";

/**
 * Чистые правила исполнения (R1.1) — без БД, чтобы их можно было проверить тестами отдельно.
 * Главный принцип: при неопределённости система не отправляет повторно и не называет результат подтверждённым.
 */

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Секрет выдаётся один раз; в БД хранится только хэш. */
export function newSecret(prefix: "ohp" | "ohr" | "ohl"): { secret: string; hash: string } {
  const secret = `${prefix}_${randomBytes(24).toString("hex")}`;
  return { secret, hash: sha256(secret) };
}

/** Локальная календарная дата в часовом поясе подключения — ключ дневного лимита. */
export function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Секунд до следующей локальной полуночи (приблизительно, для подсказки исполнителю). */
export function secondsToLocalMidnight(date: Date, timeZone: string): number {
  const key = localDateKey(date, timeZone);
  let low = 0; let high = 26 * 3600;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDateKey(new Date(date.getTime() + mid * 1000), timeZone) === key) low = mid + 1; else high = mid;
  }
  return Math.max(60, low);
}

/** Вакансия должна иметь числовой идентификатор HH и ссылку на домен hh.ru — иначе получатель не определён однозначно. */
export function hhRecipientProblem(recipient: { sourceType: string; externalId: string | null; url: string | null }): string | null {
  if (recipient.sourceType !== "hh") return "Отправка поддерживается только для вакансий HH (источник карточки не «hh»).";
  if (!recipient.externalId || !/^\d{1,20}$/.test(recipient.externalId)) return "У карточки нет числового идентификатора вакансии HH — получатель не определён.";
  if (!recipient.url) return "У карточки нет ссылки на вакансию HH.";
  try {
    const url = new URL(recipient.url);
    if (!/^https:$/.test(url.protocol) || !(url.hostname === "hh.ru" || url.hostname.endsWith(".hh.ru")) || url.username || url.password) return "Ссылка карточки не ведёт на hh.ru.";
    if (!new RegExp(`/vacancy/${recipient.externalId}(?:/|$)`).test(url.pathname)) return "Идентификатор вакансии не совпадает со ссылкой карточки.";
  } catch { return "Ссылка карточки некорректна."; }
  return null;
}

/**
 * Подтверждает ли набор доказательств, что ЭТА отправка произошла: нужны доказательство вида event/message/ui_transition,
 * привязанное к тому же аккаунту и тому же получателю и наблюдённое не раньше резервирования отправки.
 * Скриншот, текст в поле формы или общая пометка «успех» подтверждением не являются.
 */
export function evidenceConfirmsSend(evidence: Evidence[], ctx: { accountId: string; recipientExternalId: string; submitStartedAt: Date }): boolean {
  return evidence.some((e) => CONFIRMING_EVIDENCE_KINDS.includes(e.kind) && !!e.ref?.trim() && e.accountId === ctx.accountId && e.recipientExternalId === ctx.recipientExternalId && new Date(e.at).getTime() >= ctx.submitStartedAt.getTime() && new Date(e.at).getTime() <= Date.now() + 5000);
}

export interface OutcomeDecision {
  state: AttemptState; basis: "runner_observed" | null; errorCode: string | null; message: string | null;
  /** Увеличивает счётчик подряд идущих системных сбоев подключения. */
  systemFailure: boolean; resetsFailures: boolean; accepted: boolean; reason?: string;
}

/**
 * Единственное место, где исход исполнителя превращается в состояние. Fail-closed:
 * - подтверждение — только с квалифицирующими доказательствами и только после резервирования отправки;
 * - «не отправлено» невозможно после резервирования отправки — это `sent_unconfirmed`;
 * - сообщения о неопределённости без резервирования — нарушение протокола.
 */
export function decideOutcome(input: Pick<RunnerResultInput, "outcome" | "evidence" | "errorCode" | "errorKind" | "message">, ctx: { submitReserved: boolean; submitStartedAt: Date | null; accountId: string; recipientExternalId: string; currentState: AttemptState }): OutcomeDecision {
  const code = input.errorCode ?? null; const message = input.message ?? null;
  const base = { basis: null, errorCode: code, message, systemFailure: false, resetsFailures: false, accepted: true } as const;
  const afterSubmit = ctx.submitReserved && ctx.submitStartedAt !== null;
  switch (input.outcome) {
    case "confirmed":
      if (!afterSubmit) return { ...base, state: "needs_user_action", errorCode: "protocol_violation", message: "Исполнитель сообщил о подтверждении без резервирования отправки — результат не принят.", accepted: false, reason: "confirmed_without_reserve" };
      if (!evidenceConfirmsSend(input.evidence, { accountId: ctx.accountId, recipientExternalId: ctx.recipientExternalId, submitStartedAt: ctx.submitStartedAt! })) {
        return { ...base, state: "sent_unconfirmed", errorCode: "evidence_insufficient", message: "Подтверждение без доказательства, привязанного к аккаунту, получателю и времени. Отправка могла произойти — нужна сверка.", accepted: false, reason: "evidence_insufficient" };
      }
      return { ...base, state: "confirmed", basis: "runner_observed", resetsFailures: true };
    case "already_exists":
      if (afterSubmit) return { ...base, state: "sent_unconfirmed", errorCode: "already_exists_after_submit", message: "Исполнитель сообщил «уже существовало» после начала отправки. Неясно, что произошло — нужна сверка.", accepted: false, reason: "already_exists_after_submit" };
      return { ...base, state: "already_exists", resetsFailures: true };
    case "failed_before_send":
      if (afterSubmit) return { ...base, state: "sent_unconfirmed", errorCode: "failure_after_submit", message: "Ошибка после начала отправки: отправка могла произойти. Повтор запрещён до сверки.", accepted: false, reason: "failure_after_submit" };
      return { ...base, state: "failed_before_send", systemFailure: input.errorKind === "system" || input.errorKind === undefined };
    case "needs_user_action":
      if (afterSubmit) return { ...base, state: "sent_unconfirmed", errorCode: "user_action_after_submit", message: "Потребовалось действие человека уже после начала отправки. Отправка могла произойти — нужна сверка.", accepted: false, reason: "user_action_after_submit" };
      return { ...base, state: "needs_user_action" };
    case "sent_unconfirmed":
      if (!afterSubmit) return { ...base, state: "needs_user_action", errorCode: "protocol_violation", message: "Исполнитель сообщил о возможной отправке, но не резервировал её — результат не принят.", accepted: false, reason: "unconfirmed_without_reserve" };
      return { ...base, state: "sent_unconfirmed", errorCode: code ?? "browser_lost_after_submit", message: message ?? "Связь с браузером потеряна после нажатия. Отправка могла произойти — нужна сверка." };
  }
}

/** Состояния, из которых попытка уже не меняется без явной сверки человеком. */
export const FINAL_STATES: AttemptState[] = ["confirmed", "rejected", "canceled", "failed_before_send", "already_exists", "needs_user_action"];

export function appendTimeline(timeline: unknown, state: string, note: string, at: Date = new Date()): { at: string; state: string; note: string }[] {
  const list = Array.isArray(timeline) ? (timeline as { at: string; state: string; note: string }[]) : [];
  return [...list, { at: at.toISOString(), state, note: note.slice(0, 300) }].slice(-60);
}
