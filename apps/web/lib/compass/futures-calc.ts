// Калькулятор фьючерсной позиции: лонг/шорт, плечо, результат при стопе и цели, оценка цены ликвидации.
// Это отдельный режим калькулятора: движок Compass (сигналы, бэктест, планы, журнал) остаётся спотовым без плеча.

export type FuturesSide = "long" | "short";
export type FuturesSizing = "margin" | "qty";

export interface FuturesInput {
  side: FuturesSide;
  entry: number;
  stop: number | null;
  target: number | null;
  leverage: number;
  sizing: FuturesSizing;
  /** Маржа в валюте котировки (sizing = "margin") или количество монет (sizing = "qty"). */
  amount: number;
  /** Комиссия тейкера за одну сторону, %. */
  feePct: number;
  /** Ставка поддерживающей маржи, %: у бирж зависит от размера позиции, здесь — одно число. */
  mmrPct: number;
}

export interface FuturesOutcome {
  price: number;
  /** Результат после комиссий входа и выхода, в валюте котировки. */
  pnl: number;
  /** Результат к марже, %. */
  roiPct: number;
  /** Движение цены от входа в сторону позиции, %. */
  movePct: number;
  fees: number;
}

export interface FuturesResult {
  qty: number;
  notional: number;
  margin: number;
  liquidation: number | null;
  /** Расстояние от входа до ликвидации, % цены. */
  liquidationMovePct: number | null;
  stop: FuturesOutcome | null;
  target: FuturesOutcome | null;
  rewardRisk: number | null;
  warnings: string[];
}

export const LEVERAGE_MAX = 125;

/** Текст ошибки ввода или null, если посчитать можно. */
export function futuresInputError(i: FuturesInput): string | null {
  if (!(i.entry > 0)) return "Укажите цену входа больше нуля";
  if (!(i.leverage >= 1 && i.leverage <= LEVERAGE_MAX)) return `Плечо — от 1 до ${LEVERAGE_MAX}`;
  if (!(i.amount > 0)) return i.sizing === "margin" ? "Укажите маржу больше нуля" : "Укажите количество больше нуля";
  if (!(i.feePct >= 0 && i.feePct < 5)) return "Комиссия — от 0 до 5%";
  if (!(i.mmrPct >= 0 && i.mmrPct < 50)) return "Поддерживающая маржа — от 0 до 50%";
  const dir = i.side === "long" ? 1 : -1;
  if (i.stop != null && !(i.stop > 0 && (i.stop - i.entry) * dir < 0)) {
    return i.side === "long" ? "Стоп лонга должен быть ниже входа" : "Стоп шорта должен быть выше входа";
  }
  if (i.target != null && !(i.target > 0 && (i.target - i.entry) * dir > 0)) {
    return i.side === "long" ? "Цель лонга должна быть выше входа" : "Цель шорта должна быть ниже входа";
  }
  return null;
}

/**
 * Оценка цены ликвидации изолированной позиции (линейный контракт):
 * лонг — вход·(1 − 1/плечо + ставка поддерживающей маржи), шорт — вход·(1 + 1/плечо − ставка).
 * Биржа считает точнее: по цене маркировки, со ступенями маржи и комиссией закрытия.
 */
export function liquidationPrice(side: FuturesSide, entry: number, leverage: number, mmrPct: number): number | null {
  const mmr = mmrPct / 100;
  const price = side === "long" ? entry * (1 - 1 / leverage + mmr) : entry * (1 + 1 / leverage - mmr);
  if (!(price > 0)) return null;
  // при ставке выше 1/плечо формула даёт ликвидацию «по другую сторону» входа — позицию с такой маржой не открыть
  if ((side === "long" && price >= entry) || (side === "short" && price <= entry)) return null;
  return price;
}

export function futuresScenario(i: FuturesInput): FuturesResult {
  const dir = i.side === "long" ? 1 : -1;
  const fee = i.feePct / 100;
  const notional = i.sizing === "margin" ? i.amount * i.leverage : i.amount * i.entry;
  const qty = notional / i.entry;
  const margin = notional / i.leverage;

  const outcome = (price: number): FuturesOutcome => {
    const fees = fee * (i.entry * qty + price * qty);
    const pnl = dir * (price - i.entry) * qty - fees;
    return {
      price,
      pnl,
      roiPct: (pnl / margin) * 100,
      movePct: ((dir * (price - i.entry)) / i.entry) * 100,
      fees,
    };
  };

  const liquidation = liquidationPrice(i.side, i.entry, i.leverage, i.mmrPct);
  const stop = i.stop != null ? outcome(i.stop) : null;
  const target = i.target != null ? outcome(i.target) : null;
  const warnings: string[] = [];

  if (liquidation == null) {
    warnings.push("При таком плече и ставке поддерживающей маржи позицию не открыть: ликвидация наступает сразу.");
  } else if (stop && (liquidation - stop.price) * dir >= 0) {
    warnings.push(
      "Стоп стоит дальше цены ликвидации: биржа закроет позицию раньше, и потеряна будет вся маржа. " +
        "Подвиньте стоп ближе ко входу или уменьшите плечо.",
    );
  }
  if (!stop) {
    warnings.push("Стоп не задан: без него убыток ограничен только ликвидацией — всей маржой позиции.");
  }
  if (target && target.pnl <= 0) {
    warnings.push("Цель так близко ко входу, что комиссии съедают всю прибыль.");
  }
  if (i.leverage >= 20) {
    warnings.push(
      `Плечо ${i.leverage}×: движение цены на ${fmt(100 / i.leverage)}% против позиции уносит всю маржу.`,
    );
  }

  const rewardRisk = stop && target && stop.pnl < 0 && target.pnl > 0 ? target.pnl / -stop.pnl : null;

  return {
    qty,
    notional,
    margin,
    liquidation,
    liquidationMovePct: liquidation != null ? (Math.abs(liquidation - i.entry) / i.entry) * 100 : null,
    stop,
    target,
    rewardRisk,
    warnings,
  };
}

function fmt(n: number): string {
  return String(Number(n.toFixed(2))).replace(".", ",");
}

/** Стартовые уровни вокруг цены: стоп на 2% против позиции, цель на 4% по ней. */
export function defaultFuturesLevels(side: FuturesSide, price: number): { stop: number; target: number } {
  const dir = side === "long" ? 1 : -1;
  return { stop: price * (1 - dir * 0.02), target: price * (1 + dir * 0.04) };
}
