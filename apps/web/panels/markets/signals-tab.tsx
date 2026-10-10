"use client";

import { Badge, Button, EmptyState, IconButton, Input, Select, Skeleton, useToast } from "@orion/ui";
import { Bell, BellRing, RefreshCw, Trash2, Undo2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../lib/compass/api";
import { fmtDateTime, fmtPrice } from "../../lib/compass/format";
import type { MarketId, Signal } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

const STATUS_LABEL: Record<Signal["status"], string> = { active: "Актуален", expired: "Истёк", invalidated: "Отменён", dismissed: "Скрыт" };

/** Сигналы стратегий, состояние фонового поиска и оповещения о цене. */
export function SignalsTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const signals = useCompassQuery(workspaceId, ["signals"], () => api.signals({ limit: 100 }), { refetchMs: 60_000 });
  const watch = useCompassQuery(workspaceId, ["watch"], () => api.watch(), { refetchMs: 60_000 });
  const strategies = useCompassQuery(workspaceId, ["strategies"], () => api.strategies());
  const [scanning, setScanning] = useState(false);
  const strategyName = (id: string): string => strategies.data?.find((item) => item.id === id)?.name ?? id;

  async function scan(): Promise<void> {
    setScanning(true);
    try {
      const result = await api.scan();
      await invalidate();
      toast({
        title: result.new.length > 0 ? `Новых сигналов: ${result.new.length}` : "Новых сигналов нет",
        description: result.errors.length > 0 ? result.errors.slice(0, 2).join("; ") : undefined,
        tone: result.errors.length > 0 ? "danger" : "success"
      });
    } catch (error) {
      toast({ title: "Проверка не удалась", description: describeAuthError(error), tone: "danger" });
    } finally {
      setScanning(false);
    }
  }

  async function act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await invalidate();
    } catch (error) {
      toast({ title: "Не получилось", description: describeAuthError(error), tone: "danger" });
    }
  }

  const status = watch.data;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Поиск сигналов" className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={scanning} onClick={() => void scan()}>
            <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} /> Проверить сигналы
          </Button>
          <Button size="sm" variant="outline" onClick={() => void act(() => api.markSeen())}>
            Отметить прочитанными
          </Button>
          {status ? (
            <span className="text-label text-subtle-foreground">
              {status.background_scanner ? `Фоновый поиск: раз в ${status.interval_min} мин` : "Фоновый поиск выключен"}
              {status.last_scan_at ? ` · последний ${fmtDateTime(status.last_scan_at * 1000)}` : ""}
              {status.quiet_hours.active_now ? " · тихие часы" : ""}
            </span>
          ) : null}
        </div>
        {(status?.warnings ?? []).map((warning) => (
          <p key={warning} className="mt-2 text-label text-warning">
            {warning}
          </p>
        ))}
        {status && status.instruments.length === 0 ? (
          <p className="mt-2 text-label text-subtle-foreground">Список наблюдения Compass пуст: добавьте инструменты (вкладка «График»), и сигналы появятся здесь.</p>
        ) : null}
        {status && status.instruments.some((item) => item.status !== "ok" && item.status !== "paused") ? (
          <p className="mt-2 text-label text-subtle-foreground">
            Проблемы: {status.instruments.filter((item) => item.status !== "ok" && item.status !== "paused").map((item) => `${item.symbol} — ${item.message || item.status}`).join("; ")}
          </p>
        ) : null}
      </section>

      <section aria-label="Сигналы">
        <h3 className="mb-2 text-sm font-medium">Сигналы</h3>
        {signals.isLoading ? <Skeleton className="h-24" /> : null}
        {signals.error ? <EmptyState tone="danger" title="Сигналы не загрузились" description={describeAuthError(signals.error)} /> : null}
        {signals.data && signals.data.length === 0 ? (
          <EmptyState icon={Bell} title="Сигналов пока нет" description="Сигнал появляется, когда стратегия меняет решение на закрытой свече." />
        ) : null}
        <ul className="space-y-1.5">
          {(signals.data ?? []).map((signal) => (
            <li key={signal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm">
              <Badge tone={signal.side === "buy" ? "success" : "warning"}>{signal.side === "buy" ? "Вход" : "Выход"}</Badge>
              <span className="font-medium">{signal.symbol}</span>
              <span className="text-label text-subtle-foreground">
                {signal.market} · {signal.tf} · {strategyName(signal.strategy)}
              </span>
              <span className="tabular-nums">{fmtPrice(signal.price)}</span>
              {signal.stop ? <span className="text-label text-subtle-foreground">стоп {fmtPrice(signal.stop)}</span> : null}
              <Badge tone={signal.status === "active" ? "accent" : "neutral"}>{STATUS_LABEL[signal.status]}</Badge>
              {!signal.seen ? <Badge tone="accent">новый</Badge> : null}
              <span className="ml-auto text-label text-subtle-foreground">{fmtDateTime(signal.candle_ts)}</span>
              {signal.status === "dismissed" ? (
                <IconButton label="Вернуть сигнал" size="sm" onClick={() => void act(() => api.restoreSignal(signal.id))}>
                  <Undo2 className="h-4 w-4" />
                </IconButton>
              ) : (
                <IconButton label="Скрыть сигнал" size="sm" onClick={() => void act(() => api.dismissSignal(signal.id))}>
                  <X className="h-4 w-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      <ScreenerSection workspaceId={workspaceId} />

      <AlertsSection workspaceId={workspaceId} />
    </div>
  );
}

function ScreenerSection({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement | null {
  const screener = useCompassQuery(workspaceId, ["screener"], () => api.screener(), { refetchMs: 120_000 });
  if (!screener.data || screener.data.rows.length === 0) return null;
  return (
    <section aria-label="Скринер наблюдения">
      <h3 className="mb-2 text-sm font-medium">Скринер списка наблюдения</h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-label text-subtle-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Инструмент</th>
              <th className="px-3 py-2 text-right font-normal">Цена</th>
              <th className="px-3 py-2 text-right font-normal">20 свечей</th>
              <th className="px-3 py-2 text-right font-normal">RSI</th>
              <th className="px-3 py-2 text-right font-normal">ATR, %</th>
              <th className="px-3 py-2 font-normal">Сигналы</th>
            </tr>
          </thead>
          <tbody>
            {screener.data.rows.map((row) => (
              <tr key={`${row.market}:${row.symbol}`} className="border-t border-border">
                <td className="px-3 py-1.5">
                  {row.symbol} <span className="text-label text-subtle-foreground">{row.tf}</span>
                  {row.status !== "ok" ? <span className="ml-1 text-label text-warning">{row.message || row.status}</span> : null}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtPrice(row.last)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.change_20_pct == null ? "—" : `${row.change_20_pct > 0 ? "+" : ""}${row.change_20_pct.toFixed(1)}%`}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.rsi14 == null ? "—" : row.rsi14.toFixed(0)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.atr_pct == null ? "—" : row.atr_pct.toFixed(1)}</td>
                <td className="px-3 py-1.5">{row.signals.length === 0 ? "—" : row.signals.map((item) => (item.side === "buy" ? "вход" : "выход")).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {screener.data.notes.map((note) => (
        <p key={note} className="mt-1 text-label text-subtle-foreground">
          {note}
        </p>
      ))}
    </section>
  );
}

function AlertsSection({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const alerts = useCompassQuery(workspaceId, ["alerts"], () => api.alerts(), { refetchMs: 30_000 });
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await api.addAlert({ market, symbol: symbol.trim().toUpperCase(), price: Number(price), note });
      setSymbol("");
      setPrice("");
      setNote("");
      await invalidate();
      toast({ title: "Оповещение создано", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось создать", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <section aria-label="Оповещения о цене">
      <h3 className="mb-2 text-sm font-medium">Оповещения о цене</h3>
      <form onSubmit={(event) => void submit(event)} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Рынок
          <Select value={market} onChange={(event) => setMarket(event.target.value as MarketId)} className="w-28">
            <option value="moex">МосБиржа</option>
            <option value="crypto">Крипта</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Инструмент
          <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Когда цена дойдёт до
          <Input type="number" step="any" min="0" value={price} onChange={(event) => setPrice(event.target.value)} className="w-32" />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-label text-subtle-foreground">
          Заметка
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <Button type="submit" size="sm" disabled={!symbol.trim() || !(Number(price) > 0)}>
          <BellRing className="h-4 w-4" /> Создать
        </Button>
      </form>
      {alerts.data && alerts.data.length === 0 ? <p className="text-label text-subtle-foreground">Оповещений нет.</p> : null}
      <ul className="space-y-1.5">
        {(alerts.data ?? []).map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm">
            <span className="font-medium">{alert.symbol}</span>
            <span className="text-label text-subtle-foreground">{alert.market}</span>
            <span className="tabular-nums">
              {alert.kind === "above" ? "выше" : "ниже"} {fmtPrice(alert.price)}
            </span>
            <Badge tone={alert.status === "triggered" ? "success" : alert.status === "active" ? "accent" : "neutral"}>
              {alert.status === "triggered" ? "Сработало" : alert.status === "active" ? "Ждёт" : "Отменено"}
            </Badge>
            {alert.note ? <span className="text-label text-muted-foreground">{alert.note}</span> : null}
            {alert.status === "active" ? (
              <IconButton
                label={`Отменить оповещение ${alert.symbol}`}
                size="sm"
                className="ml-auto"
                onClick={() => void api.cancelAlert(alert.id).then(() => invalidate())}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
