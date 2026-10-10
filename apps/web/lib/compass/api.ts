import { ApiError as OrionApiError } from "@orion/core";
import type {
  AiModel,
  AiProviderInfo,
  AiResult,
  AlertDto,
  AiStatus,
  AccountDto,
  BacktestRequestBody,
  BacktestResponse,
  Candle,
  CandlesResponse,
  ChangedResponse,
  CockpitResponse,
  GlossaryTerm,
  LabResponse,
  ViolationsResponse,
  DayResponse,
  Instrument,
  JournalEntry,
  JournalMode,
  ChartDrawingDto,
  DrawingPoint,
  LevelDto,
  Market,
  MarketId,
  OosResponse,
  PresetGroup,
  PlanDto,
  PlanReview,
  Position,
  ReplaySession,
  ScreenerRow,
  RiskResponse,
  TradeScenarioResponse,
  ScanResponse,
  Settings,
  Signal,
  SignalReplay,
  CryptoBrief,
  CryptoCompare,
  CryptoConsensus,
  CryptoDerivatives,
  CryptoEvents,
  CryptoExchanges,
  CryptoLeadLag,
  CryptoLiquidity,
  DcaResult,
  ForecastBrief,
  ForecastCoreResponse,
  ForecastDto,
  ForecastEvaluate,
  ForecastReconstruction,
  Strategy,
  WatchStatus,
  WeekAccount,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** машинный код ошибки AI: off | consent | busy | auth | ai_error … */
    readonly code?: string,
  ) {
    super(message);
  }
}

// FastAPI отдаёт detail строкой (наши ошибки) или списком (валидация pydantic).
function detailText(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? "ошибка"}`)
      .join("; ");
  }
  return fallback;
}

/** Как запрос доходит до движка: ORION подставляет свой авторизованный прокси (`…/markets/engine/api/*`). */
type Transport = (method: string, path: string, body: unknown) => Promise<unknown>;
let transport: Transport | null = null;

export function setCompassTransport(next: Transport | null): void {
  transport = next;
}

/** Снимает подключение, только если оно всё ещё это: сосед по экрану мог уже подключить своё. */
export function clearCompassTransport(owner: Transport): void {
  if (transport === owner) transport = null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!transport) throw new ApiError("Compass не подключён к пространству.", 0);
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  try {
    return (await transport(init?.method ?? "GET", path, body)) as T;
  } catch (error) {
    if (error instanceof OrionApiError) {
      const payload = error.details as { code?: unknown } | null;
      const code = payload && typeof payload.code === "string" ? payload.code : undefined;
      throw new ApiError(detailText(error.details, error.message), error.status, code);
    }
    throw new ApiError("Нет связи с движком Compass. Он запущен?", 0);
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
};

export const api = {
  markets: () => request<Market[]>("/api/markets"),
  search: (market: MarketId, q: string) =>
    request<Instrument[]>(`/api/markets/${market}/search?${qs({ q })}`),
  candles: (market: MarketId, symbol: string, tf: string, limit = 500) =>
    request<CandlesResponse>(`/api/candles?${qs({ market, symbol, tf, limit })}`),

  instrument: (market: MarketId, symbol: string) =>
    request<{ price_step: number | null }>(`/api/instrument?${qs({ market, symbol })}`),

  autostart: () => request<{ supported: boolean; enabled: boolean; note: string }>("/api/app/autostart"),
  setAutostart: (enabled: boolean) =>
    request<{ supported: boolean; enabled: boolean; note: string }>("/api/app/autostart", json("PUT", { enabled })),

  sparks: (market: MarketId) =>
    request<{ tf: string; items: Record<string, { closes: number[]; last: number; change_pct: number | null }> }>(
      `/api/watchlist/sparks?${qs({ market })}`,
    ),
  watchlist: () => request<Instrument[]>("/api/watchlist"),
  addWatch: (i: Instrument) => request<Instrument>("/api/watchlist", json("POST", i)),
  // слэш в тикере (BTC/USDT) — часть пути, кодировать его нельзя
  removeWatch: (i: Instrument) => request<void>(`/api/watchlist/${i.market}/${i.symbol}`, { method: "DELETE" }),

  strategies: () => request<Strategy[]>("/api/strategies"),
  backtest: (body: BacktestRequestBody) => request<BacktestResponse>("/api/backtest", json("POST", body)),
  lab: (body: BacktestRequestBody & { grid: Record<string, number[]>; folds: number; mode: "rolling" | "anchored" }) =>
    request<LabResponse>("/api/lab", json("POST", body)),
  presets: (market: MarketId) => request<PresetGroup[]>(`/api/presets?${qs({ market })}`),
  addPreset: (market: MarketId, group: string) =>
    request<{ added: number; already: number; title: string }>(`/api/presets/${market}/${group}/add`, { method: "POST" }),
  alerts: (p: { status?: string; market?: MarketId; symbol?: string; unseen?: boolean } = {}) =>
    request<AlertDto[]>(`/api/alerts?${qs(p)}`),
  addAlert: (b: { market: MarketId; symbol: string; price: number; note?: string; kind?: "above" | "below" }) =>
    request<AlertDto & { last_price: number }>("/api/alerts", json("POST", b)),
  cancelAlert: (id: number) => request<void>(`/api/alerts/${id}`, { method: "DELETE" }),
  alertsSeen: () => request<{ marked: number }>("/api/alerts/seen", { method: "POST" }),
  cockpit: () => request<CockpitResponse>("/api/cockpit"),
  glossary: () => request<GlossaryTerm[]>("/api/glossary"),
  changed: (hours = 24) => request<ChangedResponse>(`/api/discipline/changed?${qs({ hours })}`),
  violations: (days = 7) => request<ViolationsResponse>(`/api/discipline/violations?${qs({ days })}`),
  aiWhatChanged: (hours = 24, refresh = false) =>
    request<AiResult>("/api/ai/what-changed", json("POST", { hours, refresh })),
  aiDiscipline: (days = 7, refresh = false) =>
    request<AiResult>("/api/ai/discipline", json("POST", { days, refresh })),
  aiExplainBacktest: (body: BacktestRequestBody) =>
    request<AiResult>("/api/ai/explain-backtest", json("POST", body)),
  aiExplainConcept: (concept_id: string, context?: string) =>
    request<AiResult>("/api/ai/explain-concept", json("POST", { concept_id, context })),
  validate: (body: BacktestRequestBody & { train_pct: number; grid: Record<string, number[]> }) =>
    request<OosResponse>("/api/validate", json("POST", body)),

  signals: (p: { limit?: number; unseen?: boolean; market?: MarketId; symbol?: string } = {}) =>
    request<Signal[]>(`/api/signals?${qs(p)}`),
  watch: () => request<WatchStatus>("/api/watch"),
  signalReplay: (p: { market: MarketId; symbol: string; tf: string; strategy?: string; limit?: number }) =>
    request<SignalReplay>(`/api/signals/replay?${qs(p)}`),
  dismissSignal: (id: number) => request<Signal>(`/api/signals/${id}/dismiss`, { method: "POST" }),
  restoreSignal: (id: number) => request<Signal>(`/api/signals/${id}/restore`, { method: "POST" }),
  markSeen: (market?: MarketId) =>
    request<{ marked: number }>(`/api/signals/seen?${qs({ market })}`, { method: "POST" }),
  scan: () => request<ScanResponse>("/api/scan", { method: "POST" }),

  risk: (b: { market: MarketId; symbol: string; entry: number; stop: number }) =>
    request<RiskResponse>("/api/risk", json("POST", b)),
  tradeScenario: (b: {
    market: MarketId;
    symbol: string;
    entry: number;
    stop: number;
    target?: number | null;
    sizing_mode?: "risk" | "qty";
    qty?: number | null;
  }) => request<TradeScenarioResponse>("/api/trade-scenario", json("POST", b)),
  reviewWeek: (days = 7) => request<{ accounts: WeekAccount[] }>(`/api/review/week?${qs({ days })}`),
  screener: () => request<{ rows: ScreenerRow[]; notes: string[] }>("/api/screener"),
  levels: (market: MarketId, symbol: string) => request<LevelDto[]>(`/api/levels?${qs({ market, symbol })}`),
  addLevel: (b: { market: MarketId; symbol: string; price: number; label: string }) =>
    request<LevelDto>("/api/levels", json("POST", b)),
  removeLevel: (id: number) => request<void>(`/api/levels/${id}`, { method: "DELETE" }),
  restoreLevel: (id: number) => request<{ restored: number }>(`/api/levels/${id}/restore`, { method: "POST" }),
  drawings: (market: MarketId, symbol: string) =>
    request<ChartDrawingDto[]>(`/api/drawings?${qs({ market, symbol })}`),
  addDrawing: (b: {
    market: MarketId;
    symbol: string;
    kind: ChartDrawingDto["kind"];
    points: DrawingPoint[];
    label?: string;
    locked?: boolean;
    visible_tfs?: string[] | null;
  }) => request<ChartDrawingDto>("/api/drawings", json("POST", b)),
  updateDrawing: (id: number, b: { points?: DrawingPoint[]; label?: string; locked?: boolean }) =>
    request<ChartDrawingDto>(`/api/drawings/${id}`, json("PUT", b)),
  removeDrawing: (id: number) => request<void>(`/api/drawings/${id}`, { method: "DELETE" }),
  restoreDrawing: (id: number) => request<{ restored: number }>(`/api/drawings/${id}/restore`, { method: "POST" }),
  plansActive: (market: MarketId, symbol: string) =>
    request<(PlanDto & { status: string })[]>(`/api/plans-active?${qs({ market, symbol })}`),
  accounts: () => request<AccountDto[]>("/api/accounts"),
  updateAccount: (market: string, changes: Partial<Omit<AccountDto, "market" | "currency">>) =>
    request<AccountDto>(`/api/accounts/${market}`, json("PUT", changes)),
  day: () => request<DayResponse>("/api/day"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("/api/settings", json("PUT", s)),
  cryptoBrief: (symbol: string) => request<CryptoBrief>(`/api/crypto/brief?${qs({ symbol })}`),
  cryptoExchanges: () => request<CryptoExchanges>("/api/crypto/exchanges"),
  cryptoCompare: (symbol: string, venue: string, tf: string, limit = 500) =>
    request<CryptoCompare>(`/api/crypto/compare?${qs({ symbol, venue, tf, limit })}`),
  cryptoConsensus: (symbol: string) => request<CryptoConsensus>(`/api/crypto/consensus?${qs({ symbol })}`),
  cryptoDerivatives: (symbol: string) => request<CryptoDerivatives>(`/api/crypto/derivatives?${qs({ symbol })}`),
  cryptoLiquidity: (symbol: string, notional: number) =>
    request<CryptoLiquidity>(`/api/crypto/liquidity?${qs({ symbol, notional })}`),
  cryptoLeadLag: (symbol: string, tf = "5m", bars = 500, maxLag = 5) =>
    request<CryptoLeadLag>(`/api/crypto/leadlag?${qs({ symbol, tf, bars, max_lag: maxLag })}`),
  cryptoEvents: (symbol: string, tf = "15m", bars = 500, window = 10) =>
    request<CryptoEvents>(`/api/crypto/events?${qs({ symbol, tf, bars, window })}`),
  dca: (b: { budget: number; parts: number; fee_pct?: number; prices?: number[] }) =>
    request<DcaResult>("/api/crypto/dca", json("POST", b)),

  forecastCreate: (b: { market: MarketId; symbol: string; tf: string; limit?: number; horizon?: number; stop?: number; target?: number }) =>
    request<ForecastDto>("/api/forecast", json("POST", b)),
  forecastPreview: (b: { market: MarketId; symbol: string; tf: string; limit?: number; horizon?: number; stop?: number; target?: number }) =>
    request<ForecastCoreResponse>("/api/forecast/preview", json("POST", b)),
  forecastEvaluations: (p: { market: MarketId; symbol: string; tf?: string; limit?: number }) =>
    request<{ verdict: string; horizon: number; measured_at: number; points_scored: number; skill_pct: number | null }[]>(
      `/api/forecast/evaluations?${qs(p)}`,
    ),
  forecasts: (p: { market?: MarketId; symbol?: string; tf?: string; limit?: number } = {}) =>
    request<ForecastBrief[]>(`/api/forecasts?${qs(p)}`),
  forecast: (uid: string) => request<ForecastDto>(`/api/forecast/${uid}`),
  forecastReconstruct: (p: {
    market: MarketId;
    symbol: string;
    at_ts: number;
    tf?: string;
    limit?: number;
    horizon?: number;
    seed?: number;
  }) => request<ForecastReconstruction>(`/api/forecast/reconstruct?${qs(p)}`),
  forecastEvaluate: (b: {
    market: MarketId;
    symbol: string;
    tf?: string;
    limit?: number;
    horizon?: number;
    step?: number;
    max_points?: number;
    seed?: number;
  }) => request<ForecastEvaluate>("/api/forecast/evaluate", json("POST", b)),

  aiStatus: () => request<AiStatus>("/api/ai/status"),
  aiProviders: () => request<AiProviderInfo[]>("/api/ai/providers"),
  aiModels: (provider: string) => request<AiModel[]>(`/api/ai/providers/${provider}/models`),
  explainSignal: (signalId: number, refresh = false) =>
    request<AiResult>("/api/ai/explain-signal", json("POST", { signal_id: signalId, refresh })),
  explainForecast: (uid: string, refresh = false) =>
    request<AiResult>("/api/ai/explain-forecast", json("POST", { uid, refresh })),
  reviewJournal: (p: { market?: MarketId; symbol?: string }, refresh = false) =>
    request<AiResult>("/api/ai/review-journal", json("POST", { ...p, refresh })),
  aiAsk: (p: { question: string; market?: MarketId; symbol?: string; tf?: string }, refresh = false) =>
    request<AiResult>("/api/ai/ask", json("POST", { ...p, refresh })),

  journal: (p: { market?: MarketId; symbol?: string; mode?: JournalMode } = {}) =>
    request<JournalEntry[]>(`/api/journal?${qs(p)}`),
  positions: (mode: JournalMode = "real") => request<Position[]>(`/api/journal/positions?${qs({ mode })}`),
  deletedJournal: () => request<JournalEntry[]>("/api/journal/deleted"),
  restoreJournalEntry: (id: number) => request<{ restored: number }>(`/api/journal/${id}/restore`, { method: "POST" }),
  restoreJournalBackup: (payload: unknown) =>
    request<{ added: number; skipped: number }>("/api/journal/restore", json("POST", payload)),
  addJournal: (
    e: Omit<JournalEntry, "id" | "signal_id" | "planned_stop" | "reason" | "mode" | "uid" | "deleted_at" | "plan_uid"> & {
      mode?: JournalMode;
      plan_uid?: string | null;
      signal_id?: number | null;
      planned_stop?: number | null;
      reason?: string;
    },
  ) =>
    request<JournalEntry>("/api/journal", json("POST", e)),
  replayList: () =>
    request<{ id: number; market: string; symbol: string; tf: string; status: string; replayed: number; remaining: number }[]>(
      "/api/replay",
    ),
  replayStart: (b: { market: MarketId; symbol: string; tf: string; replay_bars: number; capital?: number }) =>
    request<ReplaySession>("/api/replay", json("POST", b)),
  replayGet: (id: number) => request<ReplaySession>(`/api/replay/${id}`),
  replayCandles: (id: number) => request<{ source: string; candles: Candle[] }>(`/api/replay/${id}/candles`),
  replayOrder: (id: number, b: { side: "buy" | "sell"; qty: number; stop: number | null }) =>
    request<ReplaySession>(`/api/replay/${id}/order`, json("POST", b)),
  replayCancelOrder: (id: number) => request<ReplaySession>(`/api/replay/${id}/order`, { method: "DELETE" }),
  replayStop: (id: number, stop: number | null) => request<ReplaySession>(`/api/replay/${id}/stop`, json("POST", { stop })),
  replayStep: (id: number, bars: number) => request<ReplaySession>(`/api/replay/${id}/step`, json("POST", { bars })),
  replayFinish: (id: number) => request<ReplaySession>(`/api/replay/${id}/finish`, { method: "POST" }),
  createPlan: (b: {
    market: MarketId;
    symbol: string;
    entry: number;
    stop: number;
    target?: number | null;
    reason: string;
    signal_id?: number | null;
    qty?: number | null;
  }) => request<PlanDto>("/api/plans", json("POST", b)),
  plans: (p: { market?: MarketId; symbol?: string } = {}) => request<PlanDto[]>(`/api/plans?${qs(p)}`),
  planReview: (id: number) => request<PlanReview>(`/api/plans/${id}/review`),
  journalBackup: () => request<unknown>("/api/journal/backup.json"),
  removeJournal: (id: number) => request<void>(`/api/journal/${id}`, { method: "DELETE" }),
};
