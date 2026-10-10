"use client";

import { Badge, Button, EmptyState, Input, Select, Textarea, useToast } from "@orion/ui";
import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/compass/api";
import { fmtDateTime, fmtNum, fmtPct, fmtPrice } from "../../lib/compass/format";
import type { MarketId, PlanReview, TradeScenarioResponse } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery, useInvalidateCompass } from "./engine-gate";

/** Сделка: калькулятор риска (размер позиции по риску счёта), план сделки (неизменяемый) и сверка плана с журналом. */
export function TradeTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const { toast } = useToast();
  const invalidate = useInvalidateCompass(workspaceId);
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("SBER");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"risk" | "qty">("risk");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [scenario, setScenario] = useState<TradeScenarioResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const plans = useCompassQuery(workspaceId, ["plans"], () => api.plans({}));
  const [review, setReview] = useState<{ id: number; data: PlanReview } | null>(null);

  const valid = symbol.trim() !== "" && Number(entry) > 0 && Number(stop) > 0 && Number(stop) < Number(entry) && (target === "" || Number(target) > Number(entry)) && (mode === "risk" || Number(qty) > 0);
  const input = () => ({
    market,
    symbol: symbol.trim().toUpperCase(),
    entry: Number(entry),
    stop: Number(stop),
    target: target === "" ? null : Number(target),
    sizing_mode: mode,
    qty: mode === "qty" ? Number(qty) : null
  });

  async function calc(): Promise<void> {
    setBusy(true);
    try {
      setScenario(await api.tradeScenario(input()));
    } catch (error) {
      setScenario(null);
      toast({ title: "Не посчиталось", description: describeAuthError(error), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function savePlan(): Promise<void> {
    if (reason.trim() === "") {
      toast({ title: "Напишите причину входа", description: "План без причины не сохраняется.", tone: "danger" });
      return;
    }
    try {
      const { sizing_mode: _mode, ...base } = input();
      void _mode;
      await api.createPlan({ ...base, reason, qty: mode === "qty" ? Number(qty) : null });
      setReason("");
      await invalidate(["plans"]);
      toast({ title: "План сохранён", description: "Сохранённый план изменить нельзя.", tone: "success" });
    } catch (error) {
      toast({ title: "План не сохранился", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Калькулятор сделки" className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Рынок
            <Select value={market} onChange={(event) => setMarket(event.target.value as MarketId)} className="w-32">
              <option value="moex">МосБиржа</option>
              <option value="crypto">Крипта</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Инструмент
            <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} className="w-32" />
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Вход
            <Input type="number" step="any" min="0" value={entry} onChange={(event) => setEntry(event.target.value)} className="w-28" />
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Стоп
            <Input type="number" step="any" min="0" value={stop} onChange={(event) => setStop(event.target.value)} className="w-28" />
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Цель (необязательно)
            <Input type="number" step="any" min="0" value={target} onChange={(event) => setTarget(event.target.value)} className="w-28" />
          </label>
          <label className="flex flex-col gap-1 text-label text-subtle-foreground">
            Размер
            <Select value={mode} onChange={(event) => setMode(event.target.value as "risk" | "qty")} className="w-44">
              <option value="risk">по риску счёта</option>
              <option value="qty">своё количество</option>
            </Select>
          </label>
          {mode === "qty" ? (
            <label className="flex flex-col gap-1 text-label text-subtle-foreground">
              Количество
              <Input type="number" step="any" min="0" value={qty} onChange={(event) => setQty(event.target.value)} className="w-28" />
            </label>
          ) : null}
          <Button size="sm" disabled={!valid || busy} onClick={() => void calc()}>
            Рассчитать
          </Button>
        </div>
        {entry !== "" && stop !== "" && Number(stop) >= Number(entry) ? <p className="mt-2 text-label text-warning">Стоп должен быть ниже входа: калькулятор считает покупку (лонг).</p> : null}

        {scenario ? (
          <div className="mt-4 flex flex-col gap-2">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Stat label="Количество" value={`${fmtNum(scenario.qty, 8)}${scenario.lots ? ` (${fmtNum(scenario.lots, 4)} лот.)` : ""}`} />
              <Stat label="Стоимость входа" value={`${fmtNum(scenario.cost)} ${scenario.currency ?? ""}`} />
              <Stat label="Риск до стопа" value={`${fmtNum(scenario.risk_amount)} ${scenario.currency ?? ""}`} />
              <Stat label="Риск с издержками" value={`${fmtNum(scenario.risk_amount_worse)} ${scenario.currency ?? ""}`} />
              <Stat label="Прибыль у цели" value={scenario.profit_at_target == null ? "—" : `${fmtNum(scenario.profit_at_target)} ${scenario.currency ?? ""}`} />
              <Stat label="Прибыль/риск" value={scenario.reward_risk == null ? "—" : fmtNum(scenario.reward_risk)} />
              <Stat label="Доля капитала" value={scenario.capital_pct == null ? "—" : fmtPct(scenario.capital_pct, 1, false)} />
              <Stat label="Нагрузка риском после" value={scenario.portfolio?.heat_after_pct == null ? "—" : fmtPct(scenario.portfolio.heat_after_pct, 1, false)} />
            </dl>
            {[scenario.warning, ...scenario.warnings, ...(scenario.portfolio?.warnings ?? [])].filter(Boolean).map((text) => (
              <p key={text} className="text-label text-warning">
                {text}
              </p>
            ))}
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-label text-subtle-foreground">
                Причина входа (обязательна для плана)
                <Textarea rows={1} value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <Button size="sm" variant="outline" onClick={() => void savePlan()}>
                <ClipboardList className="h-4 w-4" /> Сохранить как план
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-label="Планы сделок">
        <h3 className="mb-2 text-sm font-medium">Планы сделок</h3>
        {plans.data && plans.data.length === 0 ? <EmptyState icon={ClipboardList} title="Планов пока нет" description="План фиксирует вход, стоп, цель и размер до сделки; потом его можно сверить с журналом." /> : null}
        <ul className="space-y-1.5">
          {(plans.data ?? []).map((plan) => (
            <li key={plan.id} className="rounded-xl border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{plan.symbol}</span>
                <span className="text-label text-subtle-foreground">{plan.market}</span>
                <span className="tabular-nums">
                  вход {fmtPrice(plan.entry)} · стоп {fmtPrice(plan.stop)}
                  {plan.target ? ` · цель ${fmtPrice(plan.target)}` : ""} · {fmtNum(plan.qty, 8)} шт.
                </span>
                <span className="ml-auto text-label text-subtle-foreground">{fmtDateTime(plan.created_at * 1000)}</span>
                <Button size="sm" variant="outline" onClick={() => void api.planReview(plan.id).then((data) => setReview({ id: plan.id, data }))}>
                  Сверить с журналом
                </Button>
              </div>
              <p className="text-label text-muted-foreground">{plan.reason}</p>
              {review?.id === plan.id ? (
                <div className="mt-2 rounded-lg border border-border p-2 text-label">
                  <Badge tone={review.data.status === "closed" ? "success" : review.data.status === "entered" ? "accent" : "neutral"}>
                    {review.data.status === "closed" ? "Закрыт" : review.data.status === "entered" ? "Вход выполнен" : "Ещё не открыт"}
                  </Badge>{" "}
                  куплено {fmtNum(review.data.bought_qty, 8)}, продано {fmtNum(review.data.sold_qty, 8)}
                  {review.data.r_multiple != null ? `, результат ${fmtNum(review.data.r_multiple)} R` : ""}
                  {review.data.deviations.map((deviation) => (
                    <p key={deviation.code} className={deviation.worse ? "text-warning" : "text-muted-foreground"}>
                      {deviation.label}: план {fmtPrice(deviation.planned)}, факт {deviation.actual == null ? "—" : fmtPrice(deviation.actual)}
                    </p>
                  ))}
                  {(review.data.notes ?? []).map((note) => (
                    <p key={note} className="text-subtle-foreground">
                      {note}
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-label text-subtle-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
