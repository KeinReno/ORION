"use client";

import { Button, EmptyState, IconButton, Input, Select, Skeleton, useToast } from "@orion/ui";
import { CandlestickSeries, createChart, HistogramSeries, LineSeries, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { Plus, Star, StarOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/compass/api";
import { fmtDateTime, fmtPrice } from "../../lib/compass/format";
import { ema, sma } from "../../lib/compass/indicators";
import type { Instrument, MarketId } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

const TIMEFRAMES: Record<MarketId, string[]> = { moex: ["1h", "1d"], crypto: ["15m", "1h", "4h", "1d"] };

/** График: свечи и объём, скользящие средние, сохранённые уровни, список наблюдения Compass и поиск инструмента. */
export function ChartTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("SBER");
  const [tf, setTf] = useState("1d");
  const [query, setQuery] = useState("");
  const [overlays, setOverlays] = useState({ sma: true, ema: false });
  const [levelPrice, setLevelPrice] = useState("");

  const candles = useCompassQuery(workspaceId, ["candles", market, symbol, tf], () => api.candles(market, symbol, tf, 500), { enabled: Boolean(symbol), refetchMs: 60_000 });
  const watchlist = useCompassQuery(workspaceId, ["watchlist"], () => api.watchlist());
  const levels = useCompassQuery(workspaceId, ["levels", market, symbol], () => api.levels(market, symbol), { enabled: Boolean(symbol) });
  const presets = useCompassQuery(workspaceId, ["presets", market], () => api.presets(market));
  const found = useCompassQuery(workspaceId, ["search", market, query], () => api.search(market, query), { enabled: query.trim().length >= 2 });

  const watched = (watchlist.data ?? []).some((item) => item.market === market && item.symbol === symbol);

  function pick(item: Instrument): void {
    setMarket(item.market);
    setSymbol(item.symbol);
    setTf(TIMEFRAMES[item.market].includes(tf) ? tf : "1d");
    setQuery("");
  }

  async function toggleWatch(): Promise<void> {
    try {
      if (watched) await api.removeWatch({ market, symbol, name: "" });
      else await api.addWatch({ market, symbol, name: "" });
      await invalidate(["watchlist"]);
      await invalidate(["watch"]);
    } catch (error) {
      toast({ title: "Не получилось", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function addLevel(): Promise<void> {
    try {
      await api.addLevel({ market, symbol, price: Number(levelPrice), label: "" });
      setLevelPrice("");
      await invalidate(["levels"]);
    } catch (error) {
      toast({ title: "Уровень не сохранился", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Рынок
          <Select
            value={market}
            onChange={(event) => {
              const next = event.target.value as MarketId;
              setMarket(next);
              setSymbol(next === "moex" ? "SBER" : "BTC/USDT");
              setTf(TIMEFRAMES[next].includes(tf) ? tf : "1d");
            }}
            className="w-32"
          >
            <option value="moex">МосБиржа</option>
            <option value="crypto">Крипта</option>
          </Select>
        </label>
        <div className="relative">
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Поиск инструмента
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Сбер, BTC…" className="w-44" />
          </label>
          {query.trim().length >= 2 && found.data ? (
            <ul className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {found.data.length === 0 ? <li className="px-2 py-1 text-label text-subtle-foreground">Ничего не найдено</li> : null}
              {found.data.slice(0, 20).map((item) => (
                <li key={`${item.market}:${item.symbol}`}>
                  <button type="button" onClick={() => pick(item)} className="w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-white/5">
                    {item.symbol} <span className="text-label text-subtle-foreground">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Таймфрейм
          <Select value={tf} onChange={(event) => setTf(event.target.value)} className="w-24">
            {TIMEFRAMES[market].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void toggleWatch()}>
          {watched ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />} {watched ? "Убрать из наблюдения" : "В наблюдение"}
        </Button>
        <label className="flex items-center gap-1.5 text-label text-muted-foreground">
          <input type="checkbox" checked={overlays.sma} onChange={(event) => setOverlays({ ...overlays, sma: event.target.checked })} /> SMA 20/50
        </label>
        <label className="flex items-center gap-1.5 text-label text-muted-foreground">
          <input type="checkbox" checked={overlays.ema} onChange={(event) => setOverlays({ ...overlays, ema: event.target.checked })} /> EMA 12/26
        </label>
      </div>

      {(watchlist.data ?? []).length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Список наблюдения">
          {(watchlist.data ?? []).map((item) => (
            <li key={`${item.market}:${item.symbol}`}>
              <button
                type="button"
                onClick={() => pick(item)}
                aria-current={item.market === market && item.symbol === symbol ? "true" : undefined}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${item.market === market && item.symbol === symbol ? "border-accent/60 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {item.symbol}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {candles.isLoading ? <Skeleton className="h-[420px]" /> : null}
      {candles.error ? <EmptyState tone="danger" title="Свечи не загрузились" description={describeAuthError(candles.error)} /> : null}
      {candles.data ? (
        <>
          <Candles candles={candles.data.candles} levels={(levels.data ?? []).map((level) => level.price)} overlays={overlays} />
          <p className="text-label text-subtle-foreground">
            Источник: {candles.data.source}
            {candles.data.stale ? " · данные устарели" : ""}
            {candles.data.fetched_at ? ` · получено ${fmtDateTime(candles.data.fetched_at * 1000)}` : ""}
            {candles.data.quality && candles.data.quality.status !== "ok" ? ` · качество ряда: ${candles.data.quality.issues.map((issue) => issue.message).join("; ")}` : ""}
          </p>
        </>
      ) : null}

      {presets.data && presets.data.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Наборы по темам: добавить в наблюдение</summary>
          <ul className="mt-2 flex flex-wrap gap-2">
            {presets.data.map((group) => (
              <li key={group.id} className="rounded-xl border border-border px-3 py-2 text-sm">
                <div className="font-medium">{group.title}</div>
                <div className="text-label text-subtle-foreground">{group.instruments.length} инструментов{group.note ? ` · ${group.note}` : ""}</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() =>
                    void api
                      .addPreset(market, group.id)
                      .then(async (result) => {
                        await invalidate(["watchlist"]);
                        await invalidate(["presets"]);
                        toast({ title: `Добавлено: ${result.added}`, description: result.already > 0 ? `Уже были: ${result.already}` : undefined, tone: "success" });
                      })
                      .catch((error: unknown) => toast({ title: "Не получилось", description: describeAuthError(error), tone: "danger" }))
                  }
                >
                  Добавить набор
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section aria-label="Уровни" className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Уровни</span>
        {(levels.data ?? []).map((level) => (
          <span key={level.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs tabular-nums">
            {fmtPrice(level.price)}
            <IconButton label={`Удалить уровень ${level.price}`} size="sm" onClick={() => void api.removeLevel(level.id).then(() => invalidate(["levels"]))}>
              <X className="h-3 w-3" />
            </IconButton>
          </span>
        ))}
        <Input type="number" step="any" min="0" value={levelPrice} onChange={(event) => setLevelPrice(event.target.value)} aria-label="Цена уровня" placeholder="Цена" className="w-28" />
        <Button size="sm" variant="outline" disabled={!(Number(levelPrice) > 0)} onClick={() => void addLevel()}>
          <Plus className="h-4 w-4" /> Уровень
        </Button>
      </section>
    </div>
  );
}

function Candles({ candles, levels, overlays }: { candles: { t: number; o: number; h: number; l: number; c: number; v: number }[]; levels: number[]; overlays: { sma: boolean; ema: boolean } }): React.ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRefs = useRef<ISeriesApi<"Line">[]>([]);
  const priceLines = useRef<IPriceLine[]>([]);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Создание графика один раз; данные и наложения обновляются отдельными эффектами.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = createChart(element, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#9aa3b2" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true }
    });
    chartRef.current = chart;
    candleSeries.current = chart.addSeries(CandlestickSeries, { upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350" });
    volume.current = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeries.current = null;
      volume.current = null;
      lineRefs.current = [];
      priceLines.current = [];
    };
  }, []);

  useEffect(() => {
    const series = candleSeries.current;
    if (!series) return;
    const rows = candles.map((item) => ({ time: Math.floor(item.t / 1000) as UTCTimestamp, open: item.o, high: item.h, low: item.l, close: item.c }));
    series.setData(rows);
    volume.current?.setData(candles.map((item) => ({ time: Math.floor(item.t / 1000) as UTCTimestamp, value: item.v, color: item.c >= item.o ? "rgba(38,166,154,0.35)" : "rgba(239,83,80,0.35)" })));

    for (const line of lineRefs.current) chartRef.current?.removeSeries(line);
    lineRefs.current = [];
    const closes = candles.map((item) => item.c);
    const add = (values: (number | null)[], color: string): void => {
      const chart = chartRef.current;
      if (!chart) return;
      const line = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      line.setData(
        values.flatMap((value, index) => (value == null ? [] : [{ time: Math.floor(candles[index]!.t / 1000) as UTCTimestamp, value }]))
      );
      lineRefs.current.push(line);
    };
    if (overlays.sma) {
      add(sma(closes, 20), "#f5b041");
      add(sma(closes, 50), "#5dade2");
    }
    if (overlays.ema) {
      add(ema(closes, 12), "#af7ac5");
      add(ema(closes, 26), "#58d68d");
    }

    for (const line of priceLines.current) series.removePriceLine(line);
    priceLines.current = levels.map((price) => series.createPriceLine({ price, color: "#c0c0c0", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "уровень" }));
    chartRef.current?.timeScale().fitContent();
  }, [candles, levels, overlays]);

  return <div ref={container} role="img" aria-label="График цены: свечи и объём" className="h-[420px] w-full rounded-xl border border-border" />;
}
