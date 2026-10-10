import type { ReplayTrade, Signal, SignalReplay } from "./types";
import { fmtPct, STRATEGY_SHORT } from "./format";
import { type LevelNames, levelLabel, triggerVerb } from "./level-names";

/** Точка на графике: записанный сигнал или вход/выход, реконструированный по правилу стратегии. */
export interface HistoryEvent {
  t: number; // начало сигнальной свечи, мс
  side: "buy" | "exit";
  price: number;
  recorded: Signal | null; // null — гипотетический: приложение его не присылало
  pnl: number | null; // у выхода — итог сделки по сигналам, %
}

export interface HistoryLine {
  price: number;
  label: string;
  kind: "entry" | "stop" | "target" | "trigger-buy" | "trigger-sell";
}

const usable = (r: SignalReplay | null | undefined, tf: string): r is SignalReplay & { trades: ReplayTrade[] } =>
  !!r && r.available && r.tf === tf && !!r.trades;

/**
 * Что нарисовать маркерами. Записанные сигналы остаются как есть; к ним добавляются переходы стратегии,
 * которых в базе нет (другой таймфрейм, время до начала наблюдения). Совпавшие по свече и стороне не дублируются.
 */
export function historyEvents(signals: Signal[], tf: string, replay: SignalReplay | null | undefined): HistoryEvent[] {
  const recorded = signals.filter((s) => s.tf === tf);
  const pnlAt = new Map<number, number>();
  if (usable(replay, tf)) for (const t of replay.trades) if (t.exit_ts != null) pnlAt.set(t.exit_ts, t.pnl_pct);
  const events: HistoryEvent[] = recorded.map((s) => ({
    t: s.candle_ts, side: s.side, price: s.price, recorded: s,
    pnl: s.side === "exit" && s.strategy === replay?.strategy ? (pnlAt.get(s.candle_ts) ?? null) : null,
  }));
  if (!usable(replay, tf)) return events;
  const have = new Set(recorded.filter((s) => s.strategy === replay.strategy).map((s) => `${s.candle_ts}:${s.side}`));
  for (const t of replay.trades) {
    if (!have.has(`${t.entry_ts}:buy`)) events.push({ t: t.entry_ts, side: "buy", price: t.entry_price, recorded: null, pnl: null });
    if (t.exit_ts != null && t.exit_price != null && !have.has(`${t.exit_ts}:exit`)) {
      events.push({ t: t.exit_ts, side: "exit", price: t.exit_price, recorded: null, pnl: t.pnl_pct });
    }
  }
  return events;
}

/** Горизонтальные ориентиры по реконструкции: расстояние до сигнала и цель/стоп открытой сделки. */
export function historyLines(
  replay: SignalReplay | null | undefined,
  tf: string,
  opts: { trigger: boolean; stops: boolean; hasActiveStop: boolean; hasActiveTarget?: boolean; names?: LevelNames },
): HistoryLine[] {
  if (!usable(replay, tf)) return [];
  const out: HistoryLine[] = [];
  const trig = replay.trigger;
  if (opts.trigger && trig) {
    const verb = triggerVerb(trig.kind, opts.names);
    const way = trig.direction === "above" ? "выше" : "ниже";
    out.push({
      price: trig.level,
      label: `${verb} при закрытии ${way} · ${fmtPct(trig.distance_pct, 1)}`, // сам уровень покажет метка на шкале цены
      kind: trig.kind === "entry" ? "trigger-buy" : "trigger-sell",
    });
  }
  const open = replay.trades.find((t) => t.open);
  if (opts.stops && open) {
    if (open.target != null && !opts.hasActiveTarget) out.push({ price: open.target, label: levelLabel("target", opts.names, { from: "rule" }), kind: "target" });
    if (open.stop != null && !opts.hasActiveStop) out.push({ price: open.stop, label: levelLabel("stop", opts.names, { from: "rule" }), kind: "stop" });
  }
  return out;
}

/** Сводка для плашки на графике. */
export function historyChip(replay: SignalReplay | null | undefined, tf: string): { text: string; title: string } | null {
  if (!replay || !replay.available) return null;
  const st = replay.stats;
  const name = STRATEGY_SHORT[replay.strategy ?? ""] ?? replay.strategy_name ?? "";
  const parts = [replay.params?.trend ? `${name} + SMA ${replay.params.trend}` : name];
  if (st && st.closed > 0) {
    parts.push(`${st.closed} сдел.`, `плюс ${Math.round(st.win_rate ?? 0)}%`, `ср. ${fmtPct(st.avg_pnl_pct, 1)}`);
    if (st.stop_hits > 0) parts.push(`стоп пробивался ${st.stop_hits}`);
  } else {
    parts.push("закрытых сделок нет");
  }
  const notes = [
    "Пересчёт правила по закрытым свечам графика, а не журнал присланных сигналов.",
    "Цены — по закрытию сигнальной свечи; бэктест входит по открытию следующей. Доходность без комиссий и проскальзывания.",
  ];
  if (replay.scanned_tf && replay.scanned_tf !== tf) {
    notes.push(`Сигналы приложение ищет на ${replay.scanned_tf}; на ${tf} это только реконструкция.`);
  }
  if (replay.note) notes.push(replay.note);
  if (replay.stale) notes.push("Источник недоступен, свечи из кэша.");
  return { text: parts.join(" · "), title: notes.join("\n") };
}

/** Серии отрезков сделок: цвет по итогу, незакрытая сделка тянется до последней свечи. */
export function tradeSegments(replay: SignalReplay | null | undefined, tf: string, max = 60) {
  if (!usable(replay, tf)) return [];
  return replay.trades.slice(-max).map((t) => ({
    from: { t: t.entry_ts, price: t.entry_price },
    to: t.open
      ? { t: replay.last_ts ?? t.entry_ts, price: replay.last_close ?? t.entry_price }
      : { t: t.exit_ts as number, price: t.exit_price as number },
    win: t.pnl_pct >= 0,
    open: t.open,
    stop: t.stop,
    target: t.open ? t.target : null,
    stopHit: t.stop_hit_ts,
  }));
}
