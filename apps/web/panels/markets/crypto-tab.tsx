"use client";

import { Badge, Button, EmptyState, Input, Select, Skeleton } from "@orion/ui";
import { useState } from "react";
import { api } from "../../lib/compass/api";
import { fmtNum, fmtPct, fmtPrice } from "../../lib/compass/format";
import type { CryptoBrief, CryptoConsensus, CryptoDerivatives, CryptoLiquidity, DcaResult } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery } from "./engine-gate";

type Section = "brief" | "consensus" | "derivatives" | "liquidity" | "dca";

const STATE_LABEL: Record<CryptoConsensus["state"], string> = {
  consensus: "Площадки согласны",
  venue_specific: "Цена зависит от площадки",
  source_suspect: "Один из источников подозрителен",
  insufficient: "Данных мало"
};

/** Крипто-инструменты Compass: сводка, согласие площадок, спот против перпетуалов, глубина рынка, покупка частями. */
export function CryptoTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [draft, setDraft] = useState("BTC/USDT");
  const [section, setSection] = useState<Section>("brief");
  const exchanges = useCompassQuery(workspaceId, ["crypto-exchanges"], () => api.cryptoExchanges());

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSymbol(draft.trim().toUpperCase());
        }}
      >
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Пара
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} className="w-40" />
        </label>
        <Select aria-label="Раздел" value={section} onChange={(event) => setSection(event.target.value as Section)} className="w-60">
          <option value="brief">Сводка по монете</option>
          <option value="consensus">Согласие площадок</option>
          <option value="derivatives">Спот и перпетуалы</option>
          <option value="liquidity">Глубина рынка</option>
          <option value="dca">Покупка частями</option>
        </Select>
        <Button type="submit" size="sm" variant="outline">
          Показать
        </Button>
        {exchanges.data ? <span className="text-label text-subtle-foreground">Основная биржа: {exchanges.data.active ?? "—"}</span> : null}
      </form>
      {section === "brief" ? <Brief workspaceId={workspaceId} symbol={symbol} /> : null}
      {section === "consensus" ? <Consensus workspaceId={workspaceId} symbol={symbol} /> : null}
      {section === "derivatives" ? <Derivatives workspaceId={workspaceId} symbol={symbol} /> : null}
      {section === "liquidity" ? <Liquidity workspaceId={workspaceId} symbol={symbol} /> : null}
      {section === "dca" ? <Dca workspaceId={workspaceId} /> : null}
    </div>
  );
}

function Load({ query, children }: { query: { isLoading: boolean; error: unknown }; children: React.ReactNode }): React.ReactElement {
  if (query.isLoading) return <Skeleton className="h-32" />;
  if (query.error) return <EmptyState tone="danger" title="Не загрузилось" description={describeAuthError(query.error)} />;
  return <>{children}</>;
}

function Brief({ workspaceId, symbol }: { workspaceId: string | undefined; symbol: string }): React.ReactElement {
  const query = useCompassQuery<CryptoBrief>(workspaceId, ["crypto-brief", symbol], () => api.cryptoBrief(symbol));
  const data = query.data;
  return (
    <Load query={query}>
      {data ? (
        <div className="flex flex-col gap-2 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Kv label="Биржа" value={data.exchange ?? "—"} />
            <Kv label="История, дней" value={String(data.profile.history_days)} />
            <Kv label="Медианный оборот" value={data.profile.median_quote_volume == null ? "—" : fmtNum(data.profile.median_quote_volume, 0)} />
            <Kv label="Корреляция с BTC" value={data.btc_correlation == null ? "—" : fmtNum(data.btc_correlation)} />
            <Kv label="Спред" value={data.spread ? fmtPct(data.spread.spread_pct, 3, false) : "—"} />
            <Kv label="BTC за 20 дней" value={data.btc.change_20d_pct == null ? "—" : fmtPct(data.btc.change_20d_pct)} />
          </dl>
          <p className="text-label text-muted-foreground">{data.btc.note}</p>
          {[...data.warnings, ...data.profile.warnings].map((warning) => (
            <p key={warning} className="text-label text-warning">
              {warning}
            </p>
          ))}
          {data.rub ? <p className="text-label text-subtle-foreground">{data.rub.assumption}</p> : null}
          <p className="text-label text-subtle-foreground">{data.fee_note}</p>
        </div>
      ) : null}
    </Load>
  );
}

function Consensus({ workspaceId, symbol }: { workspaceId: string | undefined; symbol: string }): React.ReactElement {
  const query = useCompassQuery<CryptoConsensus>(workspaceId, ["crypto-consensus", symbol], () => api.cryptoConsensus(symbol));
  const data = query.data;
  return (
    <Load query={query}>
      {data ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={data.state === "consensus" ? "success" : data.state === "insufficient" ? "neutral" : "warning"}>{STATE_LABEL[data.state]}</Badge>
            <span className="tabular-nums">общая цена {fmtPrice(data.composite)}</span>
            {data.dispersion_pct != null ? <span className="text-label text-subtle-foreground">разброс {fmtPct(data.dispersion_pct, 3, false)}</span> : null}
          </div>
          <table className="w-full max-w-xl text-sm">
            <tbody>
              {data.sources.map((source) => (
                <tr key={source.exchange} className="border-t border-border">
                  <td className="py-1 pr-3">{source.exchange}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{source.error ? <span className="text-label text-destructive">{source.error}</span> : fmtPrice(source.last)}</td>
                  <td className="py-1 text-right tabular-nums text-label text-subtle-foreground">{source.premium_pct == null ? "" : fmtPct(source.premium_pct, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-label text-subtle-foreground">{data.note}</p>
        </div>
      ) : null}
    </Load>
  );
}

function Derivatives({ workspaceId, symbol }: { workspaceId: string | undefined; symbol: string }): React.ReactElement {
  const query = useCompassQuery<CryptoDerivatives>(workspaceId, ["crypto-derivatives", symbol], () => api.cryptoDerivatives(symbol));
  const data = query.data;
  return (
    <Load query={query}>
      {data ? (
        <div className="flex flex-col gap-2 text-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Kv label="Спот" value={fmtPrice(data.spot_composite)} />
            <Kv label="Перпетуал" value={fmtPrice(data.perp_composite)} />
            <Kv label="Базис" value={data.basis_pct == null ? "—" : fmtPct(data.basis_pct, 3)} />
            <Kv label="Funding (годовой)" value={data.funding.annualized_pct == null ? "—" : fmtPct(data.funding.annualized_pct, 1)} />
            <Kv label="Открытый интерес" value={data.oi.total_usd == null ? "—" : `${fmtNum(data.oi.total_usd, 0)} $`} />
          </dl>
          <p className="text-label text-subtle-foreground">Funding положительный на {data.funding.positive} площадках, отрицательный на {data.funding.negative}.</p>
        </div>
      ) : null}
    </Load>
  );
}

function Liquidity({ workspaceId, symbol }: { workspaceId: string | undefined; symbol: string }): React.ReactElement {
  const [notional, setNotional] = useState("10000");
  const query = useCompassQuery<CryptoLiquidity>(workspaceId, ["crypto-liquidity", symbol, notional], () => api.cryptoLiquidity(symbol, Number(notional)), { enabled: Number(notional) > 0 });
  const data = query.data;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-label text-subtle-foreground">
        Объём сделки, USDT
        <Input type="number" min="1" value={notional} onChange={(event) => setNotional(event.target.value)} className="w-36" />
      </label>
      <Load query={query}>
        {data ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Лучшая покупка: {data.best.buy ? `${data.best.buy.exchange}` : "—"}; лучшая продажа: {data.best.sell ? `${data.best.sell.exchange}` : "—"}
            </p>
            <p className="text-label text-subtle-foreground">{data.note}</p>
            {data.limitations.map((limit) => (
              <p key={limit} className="text-label text-warning">
                {limit}
              </p>
            ))}
          </div>
        ) : null}
      </Load>
    </div>
  );
}

function Dca({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  void workspaceId;
  const [budget, setBudget] = useState("10000");
  const [parts, setParts] = useState("5");
  const [result, setResult] = useState<DcaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Бюджет
          <Input type="number" min="1" value={budget} onChange={(event) => setBudget(event.target.value)} className="w-32" />
        </label>
        <label className="flex flex-col gap-1 text-label text-subtle-foreground">
          Частей
          <Input type="number" min="1" max="100" value={parts} onChange={(event) => setParts(event.target.value)} className="w-24" />
        </label>
        <Button
          size="sm"
          disabled={!(Number(budget) > 0) || !(Number(parts) >= 1)}
          onClick={() => {
            setError(null);
            api
              .dca({ budget: Number(budget), parts: Number(parts) })
              .then(setResult)
              .catch((caught: unknown) => setError(describeAuthError(caught)));
          }}
        >
          Посчитать
        </Button>
      </div>
      {error ? <p className="text-label text-destructive">{error}</p> : null}
      {result ? (
        <p className="text-sm">
          {result.parts} покупок по {fmtNum(result.cash_each)} каждая. <span className="text-label text-subtle-foreground">{result.note}</span>
        </p>
      ) : null}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-label text-subtle-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
