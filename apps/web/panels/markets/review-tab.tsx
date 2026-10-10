"use client";

import { Badge, Button, EmptyState, Input, Select, Skeleton, Textarea } from "@orion/ui";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "../../lib/compass/api";
import { fmtNum, fmtPct } from "../../lib/compass/format";
import type { AiResult, MarketId } from "../../lib/compass/types";
import { describeAuthError } from "../../lib/error-message";
import { useCompassQuery } from "./engine-gate";

/** Разбор: неделя по счетам, нарушения правил, что изменилось, вопросы к AI (если включён в настройках Compass). */
export function ReviewTab({ workspaceId }: { workspaceId: string | undefined }): React.ReactElement {
  const [days, setDays] = useState("7");
  const week = useCompassQuery(workspaceId, ["review-week", days], () => api.reviewWeek(Number(days)));
  const violations = useCompassQuery(workspaceId, ["violations", days], () => api.violations(Number(days)));
  const changed = useCompassQuery(workspaceId, ["changed"], () => api.changed(24));
  const aiStatus = useCompassQuery(workspaceId, ["ai-status"], () => api.aiStatus());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-label text-subtle-foreground">
          Период
          <Select value={days} onChange={(event) => setDays(event.target.value)} className="w-32">
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
            <option value="30">30 дней</option>
          </Select>
        </label>
      </div>

      <section aria-label="Неделя по счетам">
        <h3 className="mb-2 text-sm font-medium">Итоги периода</h3>
        {week.isLoading ? <Skeleton className="h-24" /> : null}
        {week.error ? <EmptyState tone="danger" title="Разбор не загрузился" description={describeAuthError(week.error)} /> : null}
        {(week.data?.accounts ?? []).map((account) => (
          <div key={account.market} className="mb-3 rounded-xl border border-border p-3">
            <p className="mb-2 font-medium">{account.name}</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Stat label="Закрыто сделок" value={String(account.closed_trades)} />
              <Stat label="Результат" value={`${fmtNum(account.realized)} ${account.currency}`} />
              <Stat label="Доля прибыльных" value={account.win_rate_pct == null ? "—" : fmtPct(account.win_rate_pct, 0, false)} />
              <Stat label="Комиссии" value={`${fmtNum(account.fees)} ${account.currency}`} />
              <Stat label="Входов без стопа" value={String(account.entries_without_stop)} />
              <Stat label="Входов по плану" value={`${account.entries_with_plan} из ${account.entries}`} />
              <Stat label="Лучшая" value={account.best ? `${account.best.symbol} ${fmtNum(account.best.pnl)}` : "—"} />
              <Stat label="Худшая" value={account.worst ? `${account.worst.symbol} ${fmtNum(account.worst.pnl)}` : "—"} />
            </dl>
            {account.days_over_daily_limit.length > 0 ? <p className="mt-2 text-label text-warning">Дни с превышением дневного лимита: {account.days_over_daily_limit.join(", ")}</p> : null}
            {account.notes.map((note) => (
              <p key={note} className="mt-1 text-label text-subtle-foreground">
                {note}
              </p>
            ))}
          </div>
        ))}
      </section>

      <section aria-label="Дисциплина" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Дисциплина</h3>
        {violations.data ? (
          violations.data.violations.length === 0 ? (
            <Badge tone="success">Нарушений правил за период нет</Badge>
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {violations.data.violations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )
        ) : null}
        {violations.data?.text ? <p className="text-label text-subtle-foreground">{violations.data.text}</p> : null}
        {changed.data ? <p className="text-label text-muted-foreground">{changed.data.empty ? "За сутки ничего существенного не изменилось." : changed.data.text}</p> : null}
      </section>

      <AiSection enabled={aiStatus.data?.available === true} reason={aiStatus.data?.reason} />
    </div>
  );
}

function AiSection({ enabled, reason }: { enabled: boolean; reason: string | undefined }): React.ReactElement {
  const [question, setQuestion] = useState("");
  const [market, setMarket] = useState<MarketId>("moex");
  const [symbol, setSymbol] = useState("");
  const [answer, setAnswer] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api.aiAsk({ question, market, symbol: symbol.trim() ? symbol.trim().toUpperCase() : undefined }));
    } catch (caught) {
      setAnswer(null);
      setError(caught instanceof ApiError ? caught.message : describeAuthError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="AI-разбор" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">AI объясняет посчитанное</h3>
      {!enabled ? (
        <p className="text-label text-subtle-foreground">{reason ?? "AI выключен."} Включается в настройках Compass (вкладка «Настройки»): провайдер и согласие на отправку данных.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Рынок вопроса" value={market} onChange={(event) => setMarket(event.target.value as MarketId)} className="w-32">
              <option value="moex">МосБиржа</option>
              <option value="crypto">Крипта</option>
            </Select>
            <Input aria-label="Инструмент вопроса" placeholder="Инструмент (необязательно)" value={symbol} onChange={(event) => setSymbol(event.target.value)} className="w-52" />
          </div>
          <Textarea aria-label="Вопрос" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Например: что значит просадка 15% для этого правила?" />
          <div>
            <Button size="sm" disabled={busy || question.trim().length < 3} onClick={() => void ask()}>
              <Sparkles className="h-4 w-4" /> {busy ? "Думаю…" : "Спросить"}
            </Button>
          </div>
        </>
      )}
      {error ? <p className="text-label text-destructive">{error}</p> : null}
      {answer ? (
        <div className="rounded-xl border border-border p-3 text-sm whitespace-pre-wrap">
          {answer.text}
          <p className="mt-2 text-label text-subtle-foreground">
            {answer.provider} · {answer.model}
            {answer.cached ? " · из кэша" : ""}. Это пояснение к расчётам, а не рекомендация.
          </p>
        </div>
      ) : null}
    </section>
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
