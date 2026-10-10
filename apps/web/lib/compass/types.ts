// Зеркало DTO локального API (src/compass/api/app.py). Время везде — мс UTC.

export type MarketId = "moex" | "crypto";

export interface Market {
  id: MarketId;
  name: string;
  timeframes: string[];
  source: string;
  delay_seconds: number | null;
  live_supported: boolean;
  live_kind?: "stream" | "poll" | null;
  instruments: number;
}

export interface Instrument {
  market: MarketId;
  symbol: string;
  name: string;
  kind?: string;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface DataIssue {
  code: string;
  severity: "error" | "warning";
  count: number;
  message: string;
}

export interface DataQuality {
  status: "ok" | "warning" | "error";
  candles: number;
  issues: DataIssue[];
}

export interface CandlesResponse {
  stale: boolean;
  quality?: DataQuality;
  source: string;
  fetched_at: number | null;
  candles: Candle[];
}

export type LiveState = "connecting" | "restoring" | "live" | "reconnecting" | "unavailable";

export interface Signal {
  id: number;
  market: MarketId;
  symbol: string;
  tf: string;
  strategy: string;
  side: "buy" | "exit";
  candle_ts: number;
  price: number;
  stop: number | null;
  target: number | null;
  leverage: number | null;
  stake: number | null;
  fill_at: "next_open" | null;
  open_px: number | null;
  direction: "long" | "short" | null;
  swing: {
    stake: number;
    leverage: number;
    target: number;
    notional: number;
    qty: number;
    loss_usdt: number;
    profit_usdt: number;
    loss_pct: number;
    profit_pct: number;
    risk_note: string;
  } | null;
  loss_risk: { loss_money: number; loss_pct: number; currency: string } | null;
  created_at: number; // секунды
  seen: boolean;
  status: "active" | "expired" | "invalidated" | "dismissed";
  disposition: "none" | "planned" | "taken";
  role: "action" | "note";
  in_position: boolean;
  stop_hit: boolean;
  entry_signal_id: number | null;
  expires_at: number; // мс
  delay_seconds: number;
  late: boolean;
  notified_at: number | null;
  dismissed_at: number | null;
  params: Record<string, number> | null;
  source: string | null;
}

export interface ReplayTrade {
  entry_ts: number;
  entry_price: number;
  stop: number | null;
  target: number | null; // ориентир 2R, не запись в базе
  entry_fill: number | null; // открытие следующей свечи: так входит бэктест
  exit_ts: number | null;
  exit_price: number | null;
  exit_fill: number | null;
  open: boolean;
  bars: number;
  pnl_pct: number; // по сигналам, без комиссий
  pnl_stop_pct: number | null; // если бы стоп сработал раньше выхода
  stop_hit_ts: number | null;
  target_hit_ts: number | null;
}

export interface ReplayIndicator {
  id: string;
  label: string;
  pane: "price" | "osc";
  step: boolean;
  levels: { value: number; label: string }[];
  points: [number, number][];
}

export interface ReplayTrigger {
  level: number;
  distance_pct: number;
  kind: "entry" | "exit";
  direction: "above" | "below";
}

export interface SignalReplay {
  market: MarketId;
  symbol: string;
  tf: string;
  note?: string | null; // предупреждение по стратегии на этом рынке
  scanned_tf: string | null; // на каком таймфрейме приложение реально ищет сигналы
  stale: boolean;
  strategies: { id: string; name: string }[];
  available: boolean;
  reason?: string;
  strategy?: string;
  strategy_name?: string;
  params?: Record<string, number>;
  target?: 0 | 1;
  since_ts?: number;
  last_close?: number;
  last_ts?: number;
  trades?: ReplayTrade[];
  stats?: {
    trades: number;
    closed: number;
    open: number;
    win_rate: number | null;
    avg_pnl_pct: number | null;
    avg_pnl_stop_pct: number | null;
    stop_hits: number;
    gross: boolean;
  };
  indicators?: ReplayIndicator[];
  trigger?: ReplayTrigger | null;
}

export interface WatchInstrument {
  market: MarketId;
  symbol: string;
  paused: boolean;
  status: "ok" | "stale" | "error" | "short" | "paused" | "unknown";
  message: string;
  last_scan_at: number | null;
  last_ok_at: number | null;
}

export interface WatchStatus {
  background_scanner: boolean;
  background_mode: boolean;
  interval_min: number;
  last_scan_at: number | null;
  next_scan_at: number | null;
  quiet_hours: { enabled: boolean; from: string; to: string; active_now: boolean };
  warnings: string[];
  signal_valid_bars: number;
  instruments: WatchInstrument[];
  notes: string[];
}

export interface StrategyParam {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  params: StrategyParam[];
  market_notes?: Record<string, string>; // предупреждение по рынку из проверки на истории
}

export interface Trade {
  entry_ts: number;
  entry_price: number;
  exit_ts: number | null;
  exit_price: number | null;
  pnl_pct: number;
  exit_reason: "signal" | "stop" | "gap_stop" | "target" | "gap_target" | "eod" | "open";
  qty: number;
  stop: number | null;
  target: number | null;
  risk_amount: number | null;
  pnl_amount: number;
  mae_pct: number;
  mfe_pct: number;
  bars: number;
}

export interface BacktestMetrics {
  total_return_pct: number;
  buy_hold_return_pct: number;
  max_drawdown_pct: number;
  trades: number;
  open_trade: number;
  win_rate_pct: number | null;
  avg_trade_pct: number | null;
  profit_factor: number | null;
  exposure_pct: number;
  candles: number;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  cagr_pct: number | null;
  max_consecutive_losses: number;
  payoff_ratio: number | null;
  best_trade_pct: number | null;
  worst_trade_pct: number | null;
  avg_r: number | null;
  avg_mae_pct: number | null;
  avg_mfe_pct: number | null;
  stops: number;
  targets: number;
  gap_exits: number;
  ambiguous_bars: number;
  skipped_entries: number;
}

export interface WalkForwardWindow {
  start: number;
  end: number;
  return_pct: number | null;
  buy_hold_pct: number | null;
  max_drawdown_pct: number | null;
  trades: number;
}

export interface WalkForward {
  windows: WalkForwardWindow[];
  profitable_windows: number;
  n_windows: number;
  return_std_pct: number | null;
}

export interface Resampling {
  trades: number;
  simulations: number;
  profitable_share_pct: number | null;
  return_p5_pct: number | null;
  return_p50_pct: number | null;
  return_p95_pct: number | null;
  drawdown_actual_pct: number | null;
  drawdown_shuffled_p95_pct: number | null;
  drawdown_bootstrap_p95_pct: number | null;
}

export interface RunCard {
  engine_version: string;
  candles: number;
  start_ts: number;
  end_ts: number;
  data_hash: string;
  created_at: string;
  strategy_version: string | null;
  assumptions: string[];
  rules: { stop_atr_mult: number | null; target_r: number | null; risk_pct: number | null } | null;
}

export interface BacktestResponse {
  strategy: string;
  params: Record<string, number>;
  stale: boolean;
  metrics: BacktestMetrics;
  validation: { walk_forward: WalkForward | null; resampling: Resampling | null };
  run_card: RunCard;
  data_quality: DataQuality;
  warnings: string[];
  intraday: {
    tf: string;
    trading_days: number;
    trades_per_day: number | null;
    round_trip_cost_pct: number;
    feed_delay_seconds: number;
    cost_stress: { multiplier: number; fee_pct: number; slippage_pct: number; return_pct: number; trades: number }[];
  } | null;
  coverage: { requested: number; candles: number; first_ts: number; last_ts: number; exhausted: boolean };
  execution: ExecutionBlock;
  integrity: IntegrityReport;
  weaknesses: Weakness[];
  trials: { prior_variants: number; this_run_variants: number; total_variants: number; warning: string | null };
  trades: Trade[];
  equity: { t: number; v: number }[];
}

export interface ExecutionBlock {
  model: {
    fee_pct: number;
    slippage_pct: number;
    spread_pct: number;
    max_participation_pct: number | null;
    round_trip_cost_pct: number;
  };
  cost_stress: { multiplier: number; fee_pct: number; slippage_pct: number; spread_pct: number; return_pct: number; trades: number }[];
  story: string;
  max_participation_pct: number | null;
}

export interface IntegrityReport {
  passed: boolean;
  summary: string;
  checks: { id: string; title: string; status: "pass" | "fail" | "info" | "skipped"; detail: string }[];
}

export interface Weakness {
  code: string;
  severity: "bad" | "warn" | "info";
  text: string;
  learn: string[];
}

export interface GlossaryTerm {
  id: string;
  term: string;
  short: string;
  why: string;
}

export interface RiskResponse {
  qty: number;
  lots: number;
  cost: number;
  risk_amount: number;
  risk_amount_worse: number;
  budget: number;
  capped: boolean;
  warning: string | null;
  warnings: string[];
  currency: string | null;
  lot_size: number;
  capital: number;
  risk_pct: number;
  portfolio: { heat_before_pct: number | null; heat_after_pct: number | null; warnings: string[] };
  fee_pct: number;
  slippage_pct: number;
  assumptions: string[];
}

/** Черновик уровней сделки на графике (IMPROVEMENT_SPEC §6). */
export interface TradeDraft {
  entry: number;
  stop: number;
  target: number | null;
}

/** Исходы ручного long-сценария: /api/trade-scenario */
export interface TradeScenarioResponse {
  sizing_mode: "risk" | "qty";
  qty: number;
  qty_requested: number | null;
  rounded: boolean;
  lots: number;
  cost: number;
  risk_amount: number;
  risk_amount_worse: number;
  profit_at_target: number | null;
  profit_at_target_worse: number | null;
  reward_risk: number | null;
  expenses: { entry: number; exit_at_stop: number; exit_at_target: number | null };
  budget: number | null;
  capital_pct: number | null;
  capped: boolean;
  warning: string | null;
  market: MarketId;
  symbol: string;
  entry: number;
  stop: number;
  target: number | null;
  capital: number | null;
  risk_pct: number | null;
  currency: string | null;
  lot_size: number;
  portfolio: { heat_before_pct: number | null; heat_after_pct: number | null; warnings: string[] } | null;
  warnings: string[];
  assumptions: string[];
}

export type AiProviderId = "off" | "cursor" | "claude" | "ollama";

export interface Settings {
  capital: number;
  risk_pct: number;
  scan_interval_min: number;
  tf_moex: string;
  tf_crypto: string;
  ai_provider: AiProviderId;
  ai_models: Partial<Record<AiProviderId, string>>;
  ai_consent: string;
  instrument_strategies: Record<string, { strategy: string; params: Record<string, number> }>;
  default_strategy: string;
  scan_all_strategies: boolean;
  signal_valid_bars: number;
  quiet_hours: { enabled: boolean; from: string; to: string };
  paused_instruments: string[];
  experience_level: ExperienceLevel;
  crypto_exchange: string;
  crypto_fallback: string;
  background_mode: boolean;
}

export interface CryptoBrief {
  symbol: string;
  exchange: string | null;
  currency: string | null;
  profile: { history_days: number; median_quote_volume: number | null; bars: number; warnings: string[] };
  btc: { regime: string; change_20d_pct: number | null; note: string };
  btc_correlation: number | null;
  btc_link: string | null;
  spread: { bid: number; ask: number; spread_pct: number } | null;
  warnings: string[];
  education: string[];
  rub: { usd_rub: number; as_of: string; source: string; assumption: string } | null;
  fee_note: string;
}

export interface CryptoExchanges {
  options: string[];
  active: string | null;
  fallback: string | null;
  live_stream: boolean;
  note: string;
}

export interface VenueQuote {
  exchange: string | null;
  last: number | null;
  bid: number | null;
  ask: number | null;
}

export interface CryptoCompare {
  symbol: string;
  tf: string;
  primary: VenueQuote;
  venue: VenueQuote & { candles: Candle[] };
  divergence_abs: number | null;
  divergence_pct: number | null;
  /** Доля общих закрытых свечей пары с меньшим расхождением; null — истории мало. */
  divergence_percentile: number | null;
  divergence_bars: number;
}

export interface VenueConsensusSource {
  exchange: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  premium_pct: number | null;
  error: string | null;
}

/** Композит по площадкам: медиана цен, премии и состояние согласия (фаза 3 Cross-Exchange). */
export interface CryptoConsensus {
  symbol: string;
  checked_at: number;
  composite: number | null;
  state: "consensus" | "venue_specific" | "source_suspect" | "insufficient";
  label: "strong" | "medium" | "weak" | null;
  strength: number | null;
  dispersion_pct: number | null;
  agree: string[];
  suspect: string | null;
  venues_ok: number;
  thresholds: { tight_pct: number; outlier_pct: number; bad_dispersion_pct: number };
  sources: VenueConsensusSource[];
  note: string;
}

export interface DerivativeSource {
  exchange: string;
  spot_last: number | null;
  spot_change_24h_pct: number | null;
  perp_last: number | null;
  perp_change_24h_pct: number | null;
  basis_pct: number | null;
  funding_rate: number | null;
  funding_next_ms: number | null;
  oi_amount: number | null;
  oi_value_usd: number | null;
  /** Секции, которые площадка не отдала: спот | перп | funding | oi → причина. */
  field_errors: Record<string, string>;
  error: string | null;
}

export type ConsensusState = CryptoConsensus["state"];

/** Спот против перпетивов: базис, funding, открытый интерес, кто ведёт (фаза 4). */
export interface CryptoDerivatives {
  symbol: string;
  checked_at: number;
  spot_composite: number | null;
  spot_state: ConsensusState;
  perp_composite: number | null;
  perp_state: ConsensusState;
  basis_pct: number | null;
  basis_state: "flat" | "contango" | "backwardation" | null;
  funding: {
    count: number;
    positive: number;
    negative: number;
    median_pct: number | null;
    annualized_pct: number | null;
  };
  oi: { total_usd: number | null; venues_in_total: string[]; amount_only: string[] };
  leadership: {
    state: "spot_led" | "derivatives_led" | "mixed" | "unclear";
    spot_median_pct: number | null;
    perp_median_pct: number | null;
    counted: number;
    spot_votes: number;
    perp_votes: number;
  };
  venues_ok: number;
  thresholds: { basis_flat_pct: number; lead_min_pp: number };
  sources: DerivativeSource[];
  limitations: string[];
  note: string;
}

/** Полоса глубины стакана: суммы заявок в долларах по обе стороны и их перевес. */
export interface LiquidityDepth {
  band_pct: number;
  bid_usd: number;
  ask_usd: number;
  imbalance: number | null;
}

/** Оценка исполнения суммы одной стороной: VWAP, недобор и цена с комиссией. */
export interface LiquidityFill {
  vwap: number;
  filled_usd: number;
  partial: boolean;
  price_pct: number;
  cost_pct: number;
}

/** Площадка в снимке ликвидности: спред, полосы, покупка и продажа. */
export interface LiquiditySource {
  exchange: string;
  mid?: number;
  spread_pct?: number | null;
  depth?: LiquidityDepth[];
  buy?: LiquidityFill | null;
  sell?: LiquidityFill | null;
  error: string | null;
}

/** Лучшая площадка по полному объёму: дешевле и ближе к середине. */
export interface LiquidityBest {
  exchange: string;
  cost_pct: number;
  vwap: number;
  price_pct: number;
}

/** Стакан площадок: спред, полосы глубины, дисбаланс и оценка исполнения (фаза 5). */
export interface CryptoLiquidity {
  symbol: string;
  notional: number;
  checked_at: number;
  venues_ok: number;
  best: { buy: LiquidityBest | null; sell: LiquidityBest | null };
  thresholds: { depth_bands_pct: number[]; taker_fee_pct: number };
  sources: LiquiditySource[];
  limitations: string[];
  note: string;
}

/** Решение пары площадок: кто ведёт, с каким сдвигом и насколько значимо. */
export interface LeadLagPair {
  a: string;
  b: string;
  bars: number;
  leader: "a" | "b" | null;
  lag_bars: number | null;
  corr: number | null;
  t_stat: number | null;
  zero_lag_corr: number | null;
  thirds: ({ leader: "a" | "b" | null; lag_bars: number | null } | null)[];
  halves: {
    volatile_half: "first" | "second";
    first: { leader: "a" | "b" | null; lag_bars: number | null } | null;
    second: { leader: "a" | "b" | null; lag_bars: number | null } | null;
    first_median_move_pct: number | null;
    second_median_move_pct: number | null;
  };
}

/** Площадка в lead/lag: сколько пар выиграно, интервал и устойчивость. */
export interface LeadLagSource {
  exchange: string;
  decided: number;
  lead_votes: number;
  frequency: number | null;
  ci_pct: [number, number] | null;
  median_lead_bars: number | null;
  thirds_led: number;
  quiet: { decided: number; frequency: number | null };
  volatile: { decided: number; frequency: number | null };
  error: string | null;
}

/** Lead/lag площадок: кто раньше по сдвинутым корреляциям (фаза 6A). */
export interface CryptoLeadLag {
  symbol: string;
  tf: string;
  checked_at: number;
  state: "stable_leader" | "contested" | "no_stable_leadership" | "insufficient_data";
  leader: string | null;
  bars_min: number;
  bars_max: number;
  pairs_total: number;
  pairs_decided: number;
  thresholds: {
    max_lag: number;
    min_bars: number;
    t_min: number;
    lead_share_min: number;
    stable_thirds_min: number;
    min_lead_votes: number;
  };
  sources: LeadLagSource[];
  pairs: LeadLagPair[];
  limitations: string[];
  note: string;
}

/** Свеча окна вокруг события: композит, дисперсия и закрытия площадок. */
export interface EventWindowBar {
  ts: number;
  price: number;
  venues: number;
  move_pct: number | null;
  dispersion_pct: number;
  volume: number;
  prices: Record<string, number>;
}

/** Событие по композиту: движение медианы или разлад площадок. */
export interface MarketEvent {
  kind: "move" | "dispersion";
  ts: number;
  start_ts: number;
  end_ts: number;
  bars: number;
  move_pct: number | null;
  dispersion_pct: number;
  price: number;
  venues: number;
  strength: number;
  window_bars: EventWindowBar[];
}

/** Площадка в разборе событий: сколько закрытых свечей дала. */
export interface EventSource {
  exchange: string;
  bars: number;
  error: string | null;
}

/** Разбор прошедших событий: окна вокруг всплесков и разлада (фаза 6B). */
export interface CryptoEvents {
  symbol: string;
  tf: string;
  bars: number;
  bars_scanned: number;
  checked_at: number;
  window: number;
  events: MarketEvent[];
  thresholds: {
    move_mult: number;
    move_min_pct: number;
    dispersion_mult: number;
    dispersion_min_pct: number;
    move_pct: number;
    dispersion_pct: number;
    max_events: number;
    min_composite_venues: number;
  };
  sources: EventSource[];
  limitations: string[];
  note: string;
}

export interface DcaResult {
  parts: number;
  cash_each: number;
  fee_pct: number;
  budget: number;
  note: string;
  qty?: number;
  avg_price?: number | null;
  value?: number;
  pnl?: number;
}

export type ExperienceLevel = "beginner" | "trader" | "researcher";

export interface JournalDraft {
  market: MarketId;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  price: string;
  plannedStop: string;
  reason: string;
  note: string;
  signalId: number;
  planUid?: string;
  planId?: number;
}

export interface AiStatus {
  provider: AiProviderId;
  model: string | null;
  cloud: boolean | null;
  available: boolean;
  reason: string;
  consent: boolean;
}

export interface AiProviderInfo {
  id: Exclude<AiProviderId, "off">;
  name: string;
  cloud: boolean;
  default_model: string;
}

export interface AiModel {
  id: string;
  label: string;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
  cached: boolean;
  warnings: string[];
}

export interface JournalEntry {
  id: number;
  market: MarketId;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  ts: number;
  fee: number;
  note: string;
  signal_id: number | null;
  planned_stop: number | null;
  reason: string;
  mode: JournalMode;
  uid: string;
  deleted_at: number | null;
  plan_uid: string | null;
}

export type JournalMode = "real" | "paper" | "historical";

export interface Position {
  market: MarketId;
  symbol: string;
  qty: number;
  avg_price: number | null;
  realized_pnl: number;
  fees: number;
  trades: number;
  mode: JournalMode;
}

export interface ScanResponse {
  new: Signal[];
  errors: string[];
}

export interface PlanDto {
  id: number;
  uid: string;
  created_at: number;
  market: MarketId;
  symbol: string;
  source: string;
  strategy: string | null;
  strategy_version: string | null;
  params: Record<string, number> | null;
  signal_id: number | null;
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  lots: number;
  cost: number;
  risk_amount: number;
  risk_amount_worse: number;
  budget: number;
  currency: string | null;
  reward_risk: number | null;
  reason: string;
  warnings: string[];
  assumptions?: string[];
  capital: number;
  risk_pct: number;
}

export interface PlanDeviation {
  code: "entry" | "qty" | "stop";
  label: string;
  planned: number;
  actual: number | null;
  diff_pct: number | null;
  worse: boolean;
}

export interface PlanReview {
  plan_id: number;
  status: "open" | "entered" | "closed";
  bought_qty: number;
  sold_qty: number;
  fees: number;
  entries: number;
  deviations: PlanDeviation[];
  avg_entry?: number;
  avg_exit?: number;
  actual_risk_at_stop?: number;
  risk_budget?: number;
  risk_exceeded?: boolean;
  result_pct?: number;
  r_multiple?: number | null;
  notes?: string[];
}

export interface BacktestRequestBody {
  market: MarketId;
  symbol: string;
  tf: string;
  strategy: string;
  params: Record<string, number>;
  limit: number;
  capital: number;
  fee_pct: number;
  slippage_pct: number;
  spread_pct?: number;
  max_volume_pct?: number;
  stop_atr_mult?: number;
  target_r?: number;
  risk_pct?: number;
  close_eod?: boolean;
}

export interface OosSegment {
  total_return_pct: number;
  buy_hold_return_pct: number;
  max_drawdown_pct: number;
  trades: number;
  win_rate_pct: number | null;
  profit_factor: number | null;
}

export interface OosResponse {
  split: {
    train_pct: number;
    train_candles: number;
    test_candles: number;
    train_from: number;
    train_to: number;
    test_from: number;
    test_to: number;
  };
  optimization: {
    enabled: boolean;
    objective: string;
    variants: number;
    dropped_invalid: number;
    eligible: number;
    top: { params: Record<string, number>; score: number; return_pct: number; trades: number }[];
  };
  chosen: { params: Record<string, number>; train: OosSegment; test: OosSegment; train_score: number | null } | null;
  baseline: { params: Record<string, number>; train: OosSegment; test: OosSegment } | null;
  sensitivity: {
    param: string;
    value: number;
    train_score: number | null;
    train_return_pct: number;
    test_return_pct: number;
    test_trades: number;
  }[];
  cost_sensitivity: { multiplier: number; fee_pct: number; slippage_pct: number; return_pct: number; trades: number }[];
  verdict: { status: "held" | "degraded" | "inconclusive"; reasons: string[] };
  notes: string[];
  strategy: string;
  strategy_version: string;
  warnings: string[];
  trials: { prior_variants: number; this_run_variants: number; total_variants: number; warning: string | null };
}

export interface AccountDto {
  market: MarketId;
  name: string;
  currency: string;
  capital: number | null;
  risk_pct: number;
  daily_loss_limit_pct: number;
  max_open_risk_pct: number;
  max_trades_per_day: number | null;
  daily_profit_target_pct: number | null;
}

export interface AccountPosition {
  symbol: string;
  qty: number;
  avg_price: number;
  cost: number;
  stop: number | null;
  risk_at_stop: number | null;
  risk: number | null;
  risk_basis: "mark" | "cost";
  mark_price: number | null;
  mark_status: "fresh" | "stale" | "missing";
  mark_age_s: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pct: number | null;
  stop_breached: boolean;
  weight_pct: number | null;
}

export interface PortfolioTruth {
  status: "ok" | "partial" | "unmarked";
  sources: {
    journal: { entries: number; last_entry_ts: number | null };
    market: { marked: number; stale: number; missing: number };
    broker: { connected: boolean };
  };
  reconciliation: { status: "not_connected" | "match" | "mismatch"; differences: { symbol: string; kind: string; message: string }[] };
}

export interface AccountSnapshot {
  market: MarketId;
  name: string;
  currency: string;
  capital: number | null;
  equity: number | null;
  equity_complete: boolean;
  free: number | null;
  realized_total: number;
  unrealized_total: number;
  exposure_cost: number;
  truth: PortfolioTruth;
  daily_pnl: number;
  daily_limit: number | null;
  daily_limit_breached: boolean;
  daily_target: number | null;
  daily_target_reached: boolean;
  entries_today: number;
  max_trades_per_day: number | null;
  trades_limit_reached: boolean;
  exposure: number;
  exposure_pct: number | null;
  open_risk: number;
  heat_pct: number | null;
  max_open_risk_pct: number;
  positions: AccountPosition[];
  unprotected: string[];
  warnings: string[];
}

export interface DayResponse {
  accounts: AccountSnapshot[];
  unseen_signals: number;
  problem_sources: { market: MarketId; symbol: string; status: string; message: string }[];
  notes: string[];
}

export interface ReplayFill {
  ts: number;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  reason: string;
  stop: number | null;
  risk_pct: number | null;
}

export interface ReplayResult {
  equity: number;
  return_pct: number;
  buy_hold_pct: number;
  max_drawdown_pct: number;
  fills: number;
  closed_trades: number;
  win_rate_pct: number | null;
  realized: number;
  fees: number;
  entries_without_stop: number;
  max_entry_risk_pct: number;
  note: string | null;
}

export interface ReplaySession {
  id: number;
  market: MarketId;
  symbol: string;
  tf: string;
  source: string;
  status: "active" | "finished";
  capital: number;
  cursor_ts: number;
  replayed: number;
  remaining: number;
  last_close: number;
  cash: number;
  qty: number;
  avg_price: number | null;
  stop: number | null;
  pending: { side: "buy" | "sell"; qty: number; stop: number | null } | null;
  fills: ReplayFill[];
  result: ReplayResult;
  notes: string[];
  events?: string[];
}

export interface LevelDto {
  id: number;
  uid: string;
  market: MarketId;
  symbol: string;
  price: number;
  label: string;
  created_at: number;
}

export type DrawingKind = "hline" | "trend" | "rect" | "ruler" | "vline" | "ray" | "fib" | "arrow" | "text" | "channel";

export interface DrawingPoint {
  t: number;
  price: number;
}

/** Рисунок на графике: /api/drawings */
export interface ChartDrawingDto {
  id: number;
  uid: string;
  market: MarketId;
  symbol: string;
  kind: DrawingKind;
  points: DrawingPoint[];
  label: string;
  locked: boolean;
  visible_tfs: string[] | null;
  created_at: number;
  updated_at: number;
}

export interface ScreenerRow {
  market: MarketId;
  symbol: string;
  name: string;
  tf: string;
  paused: boolean;
  status: "ok" | "stale" | "error" | "short";
  message: string;
  signals: { strategy: string; side: "buy" | "exit"; id: number }[];
  last?: number;
  change_bar_pct?: number | null;
  change_20_pct?: number | null;
  above_sma20?: boolean | null;
  above_sma50?: boolean | null;
  rsi14?: number | null;
  atr_pct?: number | null;
  volume_ratio?: number | null;
  nearest_level?: { price: number; distance_pct: number } | null;
  rule_state?: Record<string, number>;
}

export interface WeekAccount {
  market: MarketId;
  name: string;
  currency: string;
  days: number;
  closed_trades: number;
  entries: number;
  fees: number;
  realized: number;
  win_rate_pct: number | null;
  best: { symbol: string; pnl: number } | null;
  worst: { symbol: string; pnl: number } | null;
  entries_without_stop: number;
  entries_with_plan: number;
  entries_without_plan: number;
  plan_deviations: { plans_reviewed: number; worse_entry: number; bigger_qty: number; risk_exceeded: number; no_stop: number };
  days_over_daily_limit: string[];
  days_over_trades_limit: string[];
  max_trades_per_day: number | null;
  notes: string[];
}


export interface CockpitQuestion {
  id: "now" | "positions" | "risk" | "plans" | "signals" | "rules" | "data";
  question: string;
  answer: string;
  status: "ok" | "attention" | "bad";
  items: Record<string, unknown>[];
}

export interface CockpitAttention {
  severity: "stop" | "bad" | "attention" | "info";
  section: string;
  text: string;
  hint: string;
  code: string;
  learn: string[];
}

export interface CockpitResponse {
  generated_at: number;
  status: "ok" | "attention" | "stop";
  headline: string;
  questions: CockpitQuestion[];
  attention: CockpitAttention[];
  notes: string[];
}

export interface LabFinding {
  code: string;
  severity: "good" | "warn" | "bad";
  title: string;
  text: string;
  learn: string[];
}

export interface LabFold {
  index: number;
  train_from: number | null;
  train_to: number | null;
  test_from: number;
  test_to: number;
  params: Record<string, number> | null;
  train_score: number | null;
  train_return_pct: number | null;
  test_return_pct: number;
  test_trades: number;
  test_max_drawdown_pct: number;
  buy_hold_pct: number | null;
  status: "ok" | "no_choice";
}

export interface LabCell {
  valid: boolean;
  return_pct?: number;
  max_drawdown_pct?: number;
  trades?: number;
  score?: number | null;
  thin?: boolean;
}

export interface LabResponse {
  verdict: {
    status: "robust" | "mixed" | "fragile" | "insufficient";
    headline: string;
    findings: LabFinding[];
    disclaimer: string;
  };
  walk_forward: {
    summary: {
      mode: string;
      optimized: boolean;
      folds: number;
      usable_folds: number;
      profitable_folds: number;
      stitched_return_pct: number | null;
      mean_return_pct: number | null;
      worst_fold_pct: number | null;
      trades: number;
      param_consistency: number | null;
      efficiency: number | null;
    };
    folds: LabFold[];
  };
  parameter_map: {
    available: boolean;
    reason?: string;
    params?: string[];
    axes?: number[][];
    matrix?: LabCell[][];
    variants?: number;
    positive_share_pct?: number | null;
    stability?: { verdict: string; text: string };
  };
  robustness: {
    bootstrap: { trades: number; mean_trade_pct: number; mean_p5_pct: number; mean_p95_pct: number; prob_no_edge_pct: number } | null;
    concentration: { top3_profit_share_pct: number | null; return_without_best_pct: number; total_return_pct: number } | null;
    drawdown: {
      max_drawdown_pct: number;
      peak_to_trough_days: number;
      recovered: boolean;
      recovery_days: number | null;
      longest_underwater_days: number;
      current_drawdown_pct: number;
    } | null;
    tail: { var95_bar_pct: number; cvar95_bar_pct: number | null; worst_bar_pct: number } | null;
    regimes: { regimes: { id: string; label: string; bars: number; return_pct: number | null; buy_hold_pct: number | null; thin: boolean }[]; dominant: string | null } | null;
    cost_stress: { multiplier: number; fee_pct: number; slippage_pct: number; spread_pct: number; return_pct: number; trades: number }[];
  };
  multiple_testing: {
    variants_this_run: number;
    prior_variants: number;
    pbo: { available: boolean; value: number | null; reason?: string };
    dsr: { available: boolean; value: number | null; trials?: number };
  };
  research: Record<string, number | null> | null;
  notes: string[];
  warnings: string[];
  trials: { prior_variants: number; this_run_variants: number; total_variants: number; warning: string | null };
}

export interface ChangedResponse {
  hours: number;
  empty: boolean;
  text: string;
}

export interface ViolationsResponse {
  violations: string[];
  status: string;
  text: string;
}

export interface PresetInstrument extends Instrument {
  watched: boolean;
}

export interface PresetGroup {
  id: string;
  title: string;
  icon: string;
  note: string;
  instruments: PresetInstrument[];
}

export interface AlertDto {
  id: number;
  market: MarketId;
  symbol: string;
  kind: "above" | "below";
  price: number;
  note: string;
  created_at: number;
  status: "active" | "triggered" | "cancelled";
  triggered_at: number | null;
  triggered_price: number | null;
  seen: boolean;
}

/** Шаг распределения: абсолютные цены процентилей на k-й свече горизонта. */
export interface ForecastStep {
  step: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface ForecastTerminal {
  p5_pct: number;
  p10_pct: number;
  p25_pct: number;
  p50_pct: number;
  p75_pct: number;
  p90_pct: number;
  p95_pct: number;
  mean_pct: number;
  prob_up_pct: number;
  prob_up_status: string;
}

export interface ForecastDistribution {
  paths: number;
  seed: number;
  basis: string;
  steps: ForecastStep[];
  terminal: ForecastTerminal;
  mae_median_pct: number;
  mfe_median_pct: number;
  range?: {
    lookback: number;
    high: number;
    low: number;
    breakout_pct: number | null;
    breakdown_pct: number | null;
    inside_pct: number | null;
    status: string;
  } | null;
  barriers?: ForecastBarriers | null;
}

export interface ForecastBarriers {
  status: string;
  stop: number | null;
  target: number | null;
  target_before_stop_pct: number | null;
  stop_before_target_pct: number | null;
  note: string;
}

/** Сценарий-зона: медианный путь и условия отмены. Вероятности скрыты до калибровки. */
export interface ForecastScenario {
  id: "bear" | "base" | "bull";
  label: string;
  probability: number | null;
  probability_status: string;
  empty_group: boolean;
  terminal_median_pct: number;
  terminal_range_pct: [number, number];
  median_path: number[];
  invalidation: { low: number | null; high: number | null; text: string };
}

export interface ForecastRegime {
  trend: "up" | "down" | "range";
  volatility: "low" | "normal" | "high";
  shock: boolean;
  trend_z20: number | null;
  vol_rank: number | null;
  vol_window: number;
}

export interface ForecastAnalogues {
  candidates: number;
  chosen: number;
  separation: number;
  distance: { min: number | null; median: number | null; max: number | null };
  span: { from_ts: number; to_ts: number };
  top: { ts: number; distance: number | null; forward_terminal_pct: number | null }[];
}

export interface ForecastCalibration {
  state: string;
  verdict: string;
  metrics: {
    skill_pct: number | null;
    brier: number | null;
    coverage_90_pct: number | null;
    points: number | null;
    measured_at: number | null;
    data_hash: string | null;
  } | null;
  note: string;
}

/** Ядро прогноза: то, что возвращает и снимок, и реконструкция. */
export interface ForecastCoreResponse {
  market: MarketId;
  symbol: string;
  tf: string;
  source: string;
  last_ts: number;
  base_price: number;
  horizon: number;
  data_hash: string;
  data_info: { stale: boolean; fetched_at: number | null };
  regime: ForecastRegime;
  features: Record<string, { value: number | null; z: number | null }>;
  analogues: ForecastAnalogues;
  distribution: ForecastDistribution;
  scenarios: ForecastScenario[];
  barriers?: ForecastBarriers | null;
  calibration: ForecastCalibration;
  assumptions: string[];
  warnings: string[];
}

/** Снимок прогноза: неизменяем, хранится на сервере. */
export interface ForecastDto extends ForecastCoreResponse {
  uid: string;
  model: string;
  model_version: string;
  feature_version: string;
  candles: number;
  created_at: number;
  summary: {
    trend: string;
    volatility: string;
    shock: boolean;
    calibration: string;
    chosen_analogues: number | null;
  };
}

export interface ForecastBrief {
  uid: string;
  market: MarketId;
  symbol: string;
  tf: string;
  created_at: number;
  last_ts: number;
  base_price: number;
  horizon: number;
  model: string;
  model_version: string;
  trend: string;
  volatility: string;
  shock: boolean;
  calibration: string;
  chosen_analogues: number | null;
  data_stale: boolean;
  warnings: number;
}

/** Реконструкция на прошлый момент: прогнозу видны только свечи до него. Не снимок. */
export interface ForecastReconstruction extends ForecastCoreResponse {
  reconstruction: {
    method: string;
    at_ts: number;
    origin_ts: number;
    bars_visible: number;
    bars_after: number;
    note: string;
  };
}

/** Walk-forward проверка надёжности: вердикт честный, пороги — в ответе числами. */
export interface ForecastEvaluate {
  market: MarketId;
  symbol: string;
  tf: string;
  source: string;
  data_hash: string;
  data_info: { stale: boolean; fetched_at: number | null };
  model: string;
  model_version: string;
  feature_version: string;
  horizon: number;
  seed: number;
  candles: number;
  points: { scored: number; skipped: number; step: number; requested_step: number | null; max_points: number };
  range: { from_ts: number; to_ts: number } | null;
  probability: { n: number; brier: number | null; logloss: number | null; accuracy_pct: number | null; bias_pct: number | null };
  baselines: Record<string, { n: number; brier: number | null }>;
  skill_pct: number | null;
  skill_reference: string | null;
  coverage: Record<string, { nominal_pct: number; actual_pct: number | null; covered: number; n: number }>;
  crps: { mean_pct: number | null; n: number };
  verdict: "good" | "limited" | "poor" | "insufficient_data";
  verdict_reason: string;
  thresholds: Record<string, unknown>;
  assumptions: string[];
  warnings: string[];
  by_trend?: { group: string; n: number; brier: number | null }[];
  by_volatility?: { group: string; n: number; brier: number | null }[];
  reliability_curve?: { from_pct: number | null; to_pct: number | null; count: number; mean_p_pct: number | null; actual_pct: number | null }[];
  challenger?: { name: string; role: string; beats_champion: boolean; note: string };
}
