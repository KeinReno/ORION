"use client";

import { Badge, Button, EmptyState, Input, Skeleton, useToast } from "@orion/ui";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/compass/api";
import { fmtNum, fmtPct, fmtPrice, pnlClass } from "../../lib/compass/format";
import type { AccountDto, AccountSnapshot } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

/** «День»: состояние счетов Compass (капитал, результат дня, лимиты риска, позиции) и их настройки. */
export function AccountsTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const day = useCompassQuery(workspaceId, ["day"], () => api.day(), { refetchMs: 30_000 });
  const accounts = useCompassQuery(workspaceId, ["accounts"], () => api.accounts());

  if (day.isLoading || accounts.isLoading) return <Skeleton className="h-40" />;
  if (day.error || accounts.error) return <EmptyState tone="danger" title="Счета не загрузились" description={describeAuthError(day.error ?? accounts.error)} />;

  return (
    <div className="flex flex-col gap-6">
      {(day.data?.notes ?? []).map((note) => (
        <p key={note} className="text-label text-subtle-foreground">
          {note}
        </p>
      ))}
      {(day.data?.problem_sources ?? []).length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-label">
          Источники с проблемами: {day.data?.problem_sources.map((item) => `${item.symbol} (${item.status})`).join(", ")}
        </div>
      ) : null}
      {(day.data?.accounts ?? []).length === 0 ? <EmptyState icon={Wallet} title="Счетов нет" /> : null}
      {(day.data?.accounts ?? []).map((snapshot) => (
        <AccountCard key={snapshot.market} snapshot={snapshot} account={accounts.data?.find((item) => item.market === snapshot.market)} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

function AccountCard({ snapshot, account, workspaceId }: { snapshot: AccountSnapshot; account: AccountDto | undefined; workspaceId: string | undefined }): React.ReactElement {
  const money = (value: number | null): string => (value == null ? "—" : `${fmtNum(value)} ${snapshot.currency}`);
  return (
    <section className="rounded-2xl border border-border p-4" aria-label={snapshot.name}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-medium">{snapshot.name}</h3>
        <Badge>{snapshot.currency}</Badge>
        {snapshot.daily_limit_breached ? <Badge tone="danger">Дневной лимит убытка превышен</Badge> : null}
        {snapshot.trades_limit_reached ? <Badge tone="warning">Лимит сделок в день достигнут</Badge> : null}
        {snapshot.daily_target_reached ? <Badge tone="success">Дневная цель достигнута</Badge> : null}
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="Капитал" value={money(snapshot.capital)} />
        <Stat label="Оценка счёта" value={`${money(snapshot.equity)}${snapshot.equity_complete ? "" : " (неполная)"}`} />
        <Stat label="Свободно" value={money(snapshot.free)} />
        <Stat label="Результат дня" value={money(snapshot.daily_pnl)} tone={snapshot.daily_pnl} />
        <Stat label="Реализовано" value={money(snapshot.realized_total)} tone={snapshot.realized_total} />
        <Stat label="Нереализовано" value={money(snapshot.unrealized_total)} tone={snapshot.unrealized_total} />
        <Stat label="Открытый риск" value={`${money(snapshot.open_risk)}${snapshot.heat_pct != null ? ` · ${fmtPct(snapshot.heat_pct, 1, false)}` : ""}`} />
        <Stat label="Сделок сегодня" value={`${snapshot.entries_today}${snapshot.max_trades_per_day ? ` из ${snapshot.max_trades_per_day}` : ""}`} />
      </dl>
      {snapshot.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-label text-warning">
          {warning}
        </p>
      ))}
      {snapshot.unprotected.length > 0 ? <p className="mt-2 text-label text-warning">Без стопа: {snapshot.unprotected.join(", ")}</p> : null}

      {snapshot.positions.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-label text-subtle-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">Позиция</th>
                <th className="py-1 pr-3 text-right font-normal">Кол-во</th>
                <th className="py-1 pr-3 text-right font-normal">Средняя</th>
                <th className="py-1 pr-3 text-right font-normal">Стоп</th>
                <th className="py-1 pr-3 text-right font-normal">Рынок</th>
                <th className="py-1 text-right font-normal">Нереализ.</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.positions.map((position) => (
                <tr key={position.symbol} className="border-t border-border">
                  <td className="py-1 pr-3">{position.symbol}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtNum(position.qty, 8)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtPrice(position.avg_price)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{position.stop ? fmtPrice(position.stop) : "—"}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtPrice(position.mark_price)}</td>
                  <td className={`py-1 text-right tabular-nums ${pnlClass(position.unrealized_pnl)}`}>
                    {position.unrealized_pnl == null ? "—" : fmtNum(position.unrealized_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {account ? <AccountSettings account={account} workspaceId={workspaceId} /> : null}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }): React.ReactElement {
  return (
    <div>
      <dt className="text-label text-subtle-foreground">{label}</dt>
      <dd className={`tabular-nums ${tone === undefined ? "" : pnlClass(tone)}`}>{value}</dd>
    </div>
  );
}

function AccountSettings({ account, workspaceId }: { account: AccountDto; workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const [draft, setDraft] = useState({
    capital: account.capital?.toString() ?? "",
    risk_pct: account.risk_pct.toString(),
    daily_loss_limit_pct: account.daily_loss_limit_pct.toString(),
    max_open_risk_pct: account.max_open_risk_pct.toString(),
    max_trades_per_day: account.max_trades_per_day?.toString() ?? ""
  });
  const [saving, setSaving] = useState(false);
  const field = (key: keyof typeof draft, label: string, hint?: string): React.ReactElement => (
    <label className="flex flex-col gap-1 text-label text-subtle-foreground">
      {label}
      <Input type="number" step="any" min="0" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} className="w-32" title={hint} />
    </label>
  );

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await api.updateAccount(account.market, {
        capital: draft.capital === "" ? null : Number(draft.capital),
        risk_pct: Number(draft.risk_pct),
        daily_loss_limit_pct: Number(draft.daily_loss_limit_pct),
        max_open_risk_pct: Number(draft.max_open_risk_pct),
        max_trades_per_day: draft.max_trades_per_day === "" ? null : Number(draft.max_trades_per_day)
      });
      await invalidate();
      toast({ title: "Настройки счёта сохранены", tone: "success" });
    } catch (error) {
      toast({ title: "Не сохранилось", description: describeAuthError(error), tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm text-muted-foreground">Капитал и лимиты риска</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {field("capital", `Капитал, ${account.currency}`, "Пусто — капитал не задан")}
        {field("risk_pct", "Риск на сделку, %")}
        {field("daily_loss_limit_pct", "Дневной лимит убытка, %")}
        {field("max_open_risk_pct", "Макс. открытый риск, %")}
        {field("max_trades_per_day", "Макс. сделок в день", "Пусто — без лимита")}
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </details>
  );
}
