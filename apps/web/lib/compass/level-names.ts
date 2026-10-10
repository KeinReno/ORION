/** Как называются вход, стоп и цель на графике. Выбирается в меню «Вид». */
export type LevelNames = "classic" | "short" | "plain" | "icons";

export const LEVEL_NAMES: { id: LevelNames; label: string; hint: string }[] = [
  { id: "classic", label: "Подробно", hint: "Стоп сигнала, Цель 2R (ориентир), План №3: вход — с пояснением, откуда уровень." },
  { id: "short", label: "Коротко", hint: "Только Вход, Стоп, Цель. Откуда уровень — в подсказке и по стилю линии." },
  { id: "plain", label: "Простыми словами", hint: "Покупка, Убыток, Прибыль — без биржевых терминов." },
  { id: "icons", label: "Значки", hint: "→ Вход, ✕ Стоп, ◎ Цель: читается боковым зрением." },
];

export type LevelKind = "entry" | "stop" | "target";
/** Откуда уровень: сигнал, торговый план, правило стратегии по истории или черновик. */
export interface LevelCtx {
  from?: "signal" | "plan" | "rule" | "draft";
  planId?: number;
  /** Сумма в деньгах (со знаком уже внутри текста): «−12 USDT». */
  amount?: string;
}

const WORDS: Record<LevelNames, Record<LevelKind, string>> = {
  classic: { entry: "Вход", stop: "Стоп", target: "Цель" },
  short: { entry: "Вход", stop: "Стоп", target: "Цель" },
  plain: { entry: "Покупка", stop: "Убыток", target: "Прибыль" },
  icons: { entry: "→ Вход", stop: "✕ Стоп", target: "◎ Цель" },
};

export function levelLabel(kind: LevelKind, names: LevelNames | undefined, ctx: LevelCtx = {}): string {
  const style = names ?? "classic";
  const word = WORDS[style][kind];
  const tail = ctx.amount ? ` ${ctx.amount}` : "";
  if (style !== "classic") return `${word}${tail}`;
  if (ctx.from === "plan") return `План №${ctx.planId}: ${word.toLowerCase()}${tail}`;
  if (ctx.from === "draft" && kind === "entry") return "Черновик: вход";
  if (ctx.from === "signal" && kind === "stop") return "Стоп сигнала";
  if (ctx.from === "rule") return kind === "target" ? "Цель 2R (ориентир)" : "Стоп по правилу";
  return `${word}${tail}`;
}

/** Итог зоны сигнала. */
export function outcomeLabel(kind: "target" | "stop", names: LevelNames | undefined): string {
  const style = names ?? "classic";
  if (style === "plain") return kind === "target" ? "Прибыль зафиксирована" : "Вышли с убытком";
  return kind === "target" ? "Цель достигнута" : "Стоп сработал";
}

/** Слово для события «Вход при закрытии выше…» у линии-триггера. */
export function triggerVerb(kind: "entry" | "exit", names: LevelNames | undefined): string {
  if (names === "plain") return kind === "entry" ? "Покупка" : "Продажа";
  return kind === "entry" ? "Вход" : "Выход";
}
