"use client";

import { Badge, Button, EmptyState, Input, SegmentedControl, Select, Skeleton, useToast } from "@orion/ui";
import { FlaskConical } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/compass/api";
import { fmtDateTime, fmtNum, fmtPct, fmtPrice, pnlClass } from "../../lib/compass/format";
import type { BacktestResponse, ForecastDto, MarketId, OosResponse } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

type Mode = "backtest" | "validate" | "forecast";

const TIMEFRAMES: Record<MarketId, string[]> = {
  moex: ["1h", "1d"],
  crypto: ["15m", "1h", "4h", "1d"]
};

/** Проверка правил на истории (бэктест, проверка вне выборки) и прогноз-сценарии. Расчёты — в движке Compass; история запусков хранится там же. */
export function ResearchTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const [mode, setMode] = useState<Mode>("backtest");
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("SBER");
  const [tf, setTf] = useState("1d");
  const strategies = useCompassQuery(workspaceId, ["strategies"], () => api.strategies());
  const [strategy, setStrategy] = useState("");
  const chosenStrategy = strategy || strategies.data?.[0]?.id || "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <SegmentedControl<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "backtest", label: "Бэктест" },
            { value: "validate", label: "Вне выборки" },
            { value: "forecast", label: "Прогноз" }
          ]}
        />
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Рынок
          <Select
            value={market}
            onChange={(event) => {
              const next = event.target.value as MarketId;
              setMarket(next);
              setTf(TIMEFRAMES[next].includes(tf) ? tf : "1d");
              setSymbol(next === "moex" ? "SBER" : "BTC/USDT");
            }}
            className="w-32"
          >
            <option value="moex">МосБиржа</option>
            <option value="crypto">Крипта</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Инструмент
          <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Таймфрейм
          <Select value={tf} onChange={(event) => setTf(event.target.value)} className="w-24">
            {TIMEFRAMES[market].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </label>
        {mode !== "forecast" ? (
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Правило
            <Select value={chosenStrategy} onChange={(event) => setStrategy(event.target.value)} className="w-64">
              {(strategies.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      {mode === "backtest" ? <Backtest market={market} symbol={symbol.trim().toUpperCase()} tf={tf} strategy={chosenStrategy} /> : null}
      {mode === "validate" ? <Validate market={market} symbol={symbol.trim().toUpperCase()} tf={tf} strategy={chosenStrategy} /> : null}
      {mode === "forecast" ? <Forecast workspaceId={workspaceId} market={market} symbol={symbol.trim().toUpperCase()} tf={tf} /> : null}
    </div>
  );
}

interface RunProps {
  market: MarketId;
  symbol: string;
  tf: string;
  strategy: string;
}

function useRunner<T>(run: () => Promise<T>): { result: T | null; pending: boolean; error: string | null; start: () => void } {
  const [result, setResult] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    result,
    pending,
    error,
    start: () => {
      setPending(true);
      setError(null);
      run()
        .then(setResult)
        .catch((caught: unknown) => setError(describeAuthError(caught)))
        .finally(() => setPending(false));
    }
  };
}

function Backtest({ market, symbol, tf, strategy }: RunProps): React.ReactElement {
  const [capital, setCapital] = useState("100000");
  const [fee, setFee] = useState("0.05");
  const [slippage, setSlippage] = useState("0.05");
  const runner = useRunner<BacktestResponse>(() =>
    api.backtest({ market, symbol, tf, strategy, params: {}, limit: 1000, capital: Number(capital), fee_pct: Number(fee), slippage_pct: Number(slippage) })
  );
  const data = runner.result;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Капитал
          <Input type="number" min="1" value={capital} onChange={(event) => setCapital(event.target.value)} className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Комиссия, %
          <Input type="number" step="any" min="0" value={fee} onChange={(event) => setFee(event.target.value)} className="w-24" />
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Проскальзывание, %
          <Input type="number" step="any" min="0" value={slippage} onChange={(event) => setSlippage(event.target.value)} className="w-24" />
        </label>
        <Button size="sm" disabled={runner.pending || !symbol || !strategy || !(Number(capital) > 0)} onClick={runner.start}>
          <FlaskConical className="h-4 w-4" /> {runner.pending ? "Считаю…" : "Проверить на истории"}
        </Button>
      </div>
      {runner.error ? <EmptyState tone="danger" title="Бэктест не получился" description={runner.error} /> : null}
      {runner.pending ? <Skeleton className="h-32" /> : null}
      {data ? (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Metric label="Доходность правила" value={fmtPct(data.metrics.total_return_pct)} tone={data.metrics.total_return_pct} />
            <Metric label="Просто держать" value={fmtPct(data.metrics.buy_hold_return_pct)} tone={data.metrics.buy_hold_return_pct} />
            <Metric label="Макс. просадка" value={fmtPct(data.metrics.max_drawdown_pct, 2, false)} />
            <Metric label="Сделок" value={String(data.metrics.trades)} />
            <Metric label="Доля прибыльных" value={data.metrics.win_rate_pct == null ? "—" : fmtPct(data.metrics.win_rate_pct, 1, false)} />
            <Metric label="Профит-фактор" value={fmtNum(data.metrics.profit_factor)} />
            <Metric label="Шарп" value={fmtNum(data.metrics.sharpe)} />
            <Metric label="Свечей" value={String(data.metrics.candles)} />
          </dl>
          <EquityLine points={data.equity} />
          {data.trials.warning ? <p className="text-label text-warning">{data.trials.warning}</p> : null}
          {data.warnings.map((warning) => (
            <p key={warning} className="text-label text-warning">
              {warning}
            </p>
          ))}
          {data.weaknesses.map((weakness) => (
            <p key={weakness.code} className={`text-label ${weakness.severity === "bad" ? "text-destructive" : "text-muted-foreground"}`}>
              {weakness.text}
            </p>
          ))}
          <p className="text-label text-subtle-foreground">{data.execution.story}</p>
        </>
      ) : null}
    </div>
  );
}

function Validate({ market, symbol, tf, strategy }: RunProps): React.ReactElement {
  const runner = useRunner<OosResponse>(() => api.validate({ market, symbol, tf, strategy, params: {}, limit: 1000, capital: 100000, fee_pct: 0.05, slippage_pct: 0.05, train_pct: 70, grid: {} }));
  const data = runner.result;
  const tone = data?.verdict.status === "held" ? "success" : data?.verdict.status === "degraded" ? "danger" : "warning";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="sm" disabled={runner.pending || !symbol || !strategy} onClick={runner.start}>
          <FlaskConical className="h-4 w-4" /> {runner.pending ? "Считаю…" : "Проверить вне выборки"}
        </Button>
        <p className="mt-1 text-label text-subtle-foreground">История делится на обучающую (70%) и проверочную часть, которую правило не видело.</p>
      </div>
      {runner.error ? <EmptyState tone="danger" title="Проверка не получилась" description={runner.error} /> : null}
      {runner.pending ? <Skeleton className="h-32" /> : null}
      {data ? (
        <>
          <div className="flex items-center gap-2">
            <Badge tone={tone}>{data.verdict.status === "held" ? "Результат удержался" : data.verdict.status === "degraded" ? "Результат ухудшился" : "Вывод неоднозначен"}</Badge>
          </div>
          {data.verdict.reasons.map((reason) => (
            <p key={reason} className="text-label text-muted-foreground">
              {reason}
            </p>
          ))}
          {data.baseline ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Metric label="Обучающая часть" value={fmtPct(data.baseline.train.total_return_pct)} tone={data.baseline.train.total_return_pct} />
              <Metric label="Проверочная часть" value={fmtPct(data.baseline.test.total_return_pct)} tone={data.baseline.test.total_return_pct} />
              <Metric label="Просадка на проверке" value={fmtPct(data.baseline.test.max_drawdown_pct, 2, false)} />
              <Metric label="Сделок на проверке" value={String(data.baseline.test.trades)} />
            </dl>
          ) : null}
          {data.notes.map((note) => (
            <p key={note} className="text-label text-subtle-foreground">
              {note}
            </p>
          ))}
        </>
      ) : null}
    </div>
  );
}

function Forecast({ workspaceId, market, symbol, tf }: { workspaceId: string | undefined; market: MarketId; symbol: string; tf: string }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const history = useCompassQuery(workspaceId, ["forecasts", market, symbol, tf], () => api.forecasts({ market, symbol, tf, limit: 10 }), { enabled: Boolean(symbol) });
  const [current, setCurrent] = useState<ForecastDto | null>(null);
  const [pending, setPending] = useState(false);

  async function create(): Promise<void> {
    setPending(true);
    try {
      setCurrent(await api.forecastCreate({ market, symbol, tf }));
      await invalidate();
    } catch (error) {
      toast({ title: "Прогноз не получился", description: describeAuthError(error), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="sm" disabled={pending || !symbol} onClick={() => void create()}>
          {pending ? "Считаю…" : "Построить прогноз-сценарии"}
        </Button>
        <p className="mt-1 text-label text-subtle-foreground">Это сценарии по похожим участкам истории, а не предсказание цены. Каждый снимок сохраняется и не меняется.</p>
      </div>
      {current ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Базовая цена {fmtPrice(current.base_price)} · горизонт {current.horizon} свечей · режим: {current.regime.trend === "up" ? "рост" : current.regime.trend === "down" ? "снижение" : "боковик"}, волатильность{" "}
            {current.regime.volatility === "high" ? "высокая" : current.regime.volatility === "low" ? "низкая" : "обычная"}
          </p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {current.scenarios.map((scenario) => (
              <li key={scenario.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{scenario.label}</span>
                  <Badge tone={scenario.probability == null ? "neutral" : "accent"}>{scenario.probability == null ? "вероятность не оценена" : fmtPct(scenario.probability * 100, 0, false)}</Badge>
                </div>
                <p className={`tabular-nums ${pnlClass(scenario.terminal_median_pct)}`}>медиана {fmtPct(scenario.terminal_median_pct)}</p>
                <p className="text-label text-subtle-foreground">
                  диапазон {fmtPct(scenario.terminal_range_pct[0])} … {fmtPct(scenario.terminal_range_pct[1])}
                </p>
                <p className="mt-1 text-label text-muted-foreground">{scenario.invalidation.text}</p>
              </li>
            ))}
          </ul>
          <p className="text-label text-subtle-foreground">{current.calibration.note}</p>
          {current.warnings.map((warning) => (
            <p key={warning} className="text-label text-warning">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      <section aria-label="История прогнозов">
        <h3 className="mb-1 text-sm font-medium">Прежние снимки</h3>
        {history.data && history.data.length === 0 ? <p className="text-label text-subtle-foreground">Снимков по этому инструменту ещё нет.</p> : null}
        <ul className="space-y-1">
          {(history.data ?? []).map((item) => (
            <li key={item.uid} className="flex flex-wrap items-center gap-3 text-label text-muted-foreground">
              <span>{fmtDateTime(item.created_at * 1000)}</span>
              <span>база {fmtPrice(item.base_price)}</span>
              <span>горизонт {item.horizon}</span>
              <span>{item.trend}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: number }): React.ReactElement {
  return (
    <div>
      <dt className="text-label text-subtle-foreground">{label}</dt>
      <dd className={`tabular-nums ${tone === undefined ? "" : pnlClass(tone)}`}>{value}</dd>
    </div>
  );
}

/** Кривая капитала: простой SVG без библиотек, подпись — для чтения программой экрана. */
function EquityLine({ points }: { points: { t: number; v: number }[] }): React.ReactElement | null {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((point) => point.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${((index / (points.length - 1)) * 600).toFixed(1)},${(100 - ((point.v - min) / span) * 100).toFixed(1)}`)
      .join(" ");
  }, [points]);
  if (!path) return null;
  return (
    <svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Кривая капитала по бэктесту" className="h-32 w-full rounded-xl border border-border bg-white/[0.02]">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-accent-text" />
    </svg>
  );
}
