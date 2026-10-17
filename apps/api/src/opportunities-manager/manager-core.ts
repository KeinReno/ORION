import type { Assessment } from "@orion/shared-types";

/**
 * Правила допуска менеджера — чистые функции. Менеджер ставит отправку в очередь ТОЛЬКО если оценка проходит все пороги
 * и нет ни одного жёсткого ограничения, ни одного неподтверждённого обязательного требования, ни неизвестного существенного условия.
 * Сомнение — это «нужно решение человека» или «пропуск», но никогда не «отправить на всякий случай».
 */

export type GateDecision = "queue" | "skip" | "review";
export interface GateVerdict { decision: GateDecision; reasons: string[] }

const RANK = { low: 0, medium: 1, high: 2 } as const;
const HARD = /^Жёсткое ограничение/;

export function evaluateGates(input: { assessment: Assessment; minScore: number; minConfidence: "medium" | "high"; requiredFactIds: string[]; confirmedFactIds: ReadonlySet<string> }): GateVerdict {
  const { assessment: a } = input;
  const skip: string[] = []; const review: string[] = [];
  if (a.stale) review.push("Оценка устарела — данные изменились во время цикла.");
  for (const b of a.autoSendBlockers) (HARD.test(b) ? skip : review).push(b);
  if (a.score === null) review.push("Рейтинг не рассчитан (нет данных для оценки).");
  else if (a.score < input.minScore) skip.push(`Рейтинг ${a.score} ниже порога политики ${input.minScore}.`);
  if (RANK[a.confidence] < RANK[input.minConfidence]) review.push(`Надёжность исходных данных «${a.confidence}» ниже требуемой «${input.minConfidence}».`);
  for (const c of a.criteria) if (c.importance === "must" && c.verdict === "conflict") skip.push(`Обязательное требование «${c.text}» противоречит оспоренному факту профиля.`);
  for (const id of input.requiredFactIds) if (!input.confirmedFactIds.has(id)) skip.push("Требуемый политикой факт профиля не подтверждён или в архиве.");
  if (skip.length) return { decision: "skip", reasons: [...new Set([...skip, ...review])] };
  if (review.length) return { decision: "review", reasons: [...new Set(review)] };
  return { decision: "queue", reasons: [] };
}

const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Тихие часы в локальном времени политики; окно может переходить через полночь (например 22:00–08:00). */
export function inQuietHours(now: Date, timeZone: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const minutes = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const s = toMinutes(start); const e = toMinutes(end);
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}
