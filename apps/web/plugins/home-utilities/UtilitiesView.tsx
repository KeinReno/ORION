"use client";

import { useAddElectricityTariff, useAddMeterReading, useCopyPreviousUtilityMonth, useElectricityTariffs, usePutUtilityMonth, useUtilityMonths } from "@orion/core-react";
import { electricityEstimate, electricityForecast, electricityTariffFromAmount, utilityTotals, type UtilityMonth, type PutUtilityMonthInput, type Meter } from "@orion/shared-types";
import { Button, Card, ConfirmDialog, Input, useToast } from "@orion/ui";
import { ArrowLeft, ArrowRight, Check, Copy, Gauge, Plus, Receipt, Save, Trash2, Upload, Table2, ChartNoAxesCombined } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { HomeObjectTabSlotProps } from "../../lib/extensions/contracts";
import { ImportUtilityTable } from "./ImportUtilityTable";
import { UtilityPayments } from "./UtilityPayments";
import { UtilitiesAnalytics } from "./UtilitiesAnalytics";
import { canRecordReading, parseDecimalInput, parseRateInput, parseRubToMinor, parseWholeInput } from "./electricity-input";

const money = (minor: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(minor / 100);
const inputMoney = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");
function parseMoney(value: string): number | null {
  const clean = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const todayPeriod = () => localToday().slice(0, 7);
function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}
function labelPeriod(period: string): string {
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
const allConfirmed = (month: UtilityMonth) => month.rentConfirmed && month.charges.every((charge) => charge.confirmed);

export function UtilitiesSummary({ workspaceId, home, onOpenTab }: HomeObjectTabSlotProps): React.ReactElement {
  const { data: months } = useUtilityMonths(workspaceId, home.id);
  const current = months?.find((month) => month.period === todayPeriod());
  return <button type="button" onClick={() => onOpenTab?.("utilities")} className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left hover:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15"><Receipt className="h-5 w-5 text-accent" aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block text-2xs text-muted-foreground">Коммуналка · {labelPeriod(todayPeriod())}</span><span className="block text-title">{current ? money(current.grandTotalMinor) : "Начните новый месяц"}</span>{current && !allConfirmed(current) ? <span className="block text-2xs text-subtle-foreground">Есть суммы на проверке · подтверждено {money(current.confirmedTotalMinor)}</span> : null}</span>
    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
  </button>;
}

export function UtilitiesView({ workspaceId, home, overview, financeAvailable, onOpenTab }: HomeObjectTabSlotProps): React.ReactElement {
  const { toast } = useToast();
  const { data: months, isLoading, isError, refetch } = useUtilityMonths(workspaceId, home.id);
  const put = usePutUtilityMonth(workspaceId, home.id);
  const copy = useCopyPreviousUtilityMonth(workspaceId, home.id);
  const [period, setPeriod] = useState(todayPeriod);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingPeriod, setPendingPeriod] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const current = months?.find((month) => month.period === period);
  const hasPrevious = months?.some((month) => month.period === shiftPeriod(period, -1));

  function choosePeriod(next: string): void {
    if (next === period) return;
    if (editorDirty) { setPendingPeriod(next); return; }
    setPeriod(next);
  }

  async function start(copyPrevious: boolean): Promise<void> {
    try {
      if (copyPrevious) await copy.mutateAsync(period);
      else await put.mutateAsync({ period, input: { rentMinor: 0, rentConfirmed: false, charges: [] } });
    } catch (error) { toast({ title: "Не удалось создать месяц", description: String(error), tone: "danger" }); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-2xs uppercase tracking-[0.14em] text-subtle-foreground">Квартира · счета</p><h3 className="mt-1 text-xl font-semibold">Коммуналка</h3><p className="text-label text-muted-foreground">Квартирная плата, счета компаний и оплаты по каждому месяцу.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Перенести таблицу</Button><Button size="sm" variant="outline" onClick={() => setShowAnalytics((value) => !value)} aria-pressed={showAnalytics}><ChartNoAxesCombined className="h-4 w-4" /> Аналитика</Button><Button size="sm" variant="outline" onClick={() => setShowTable((value) => !value)}><Table2 className="h-4 w-4" /> {showTable ? "Скрыть историю" : "Вся история"}</Button><div className="flex items-center gap-1 rounded-lg border border-border p-1"><button type="button" aria-label="Предыдущий месяц" onClick={() => choosePeriod(shiftPeriod(period, -1))} className="rounded p-2 hover:bg-white/5"><ArrowLeft className="h-4 w-4" /></button><span className="min-w-36 text-center text-label">{labelPeriod(period)}</span><button type="button" aria-label="Следующий месяц" onClick={() => choosePeriod(shiftPeriod(period, 1))} className="rounded p-2 hover:bg-white/5"><ArrowRight className="h-4 w-4" /></button></div></div>
    </div>
    {isLoading ? <p className="text-label text-muted-foreground">Загрузка месяцев…</p> : isError ? <Card className="p-4"><p>Не удалось загрузить коммуналку.</p><Button size="sm" onClick={() => void refetch()}>Повторить</Button></Card> : (
      <div className="grid gap-4 [@container(min-width:900px)]:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-4">
          {current ? <><MonthEditor key={`${current.id}:${current.updatedAt}`} month={current} busy={put.isPending} onDirtyChange={setEditorDirty} onSave={(input) => put.mutateAsync({ period, input })} />{financeAvailable ? <UtilityPayments workspaceId={workspaceId} homeId={home.id} month={current} /> : <Card className="p-4 text-label text-muted-foreground">Включите модуль «Финансы», чтобы связывать оплаты со счетами.</Card>}</> : <Card className="space-y-4 p-5"><h4 className="text-title">За {labelPeriod(period).toLowerCase()} записей пока нет</h4><p className="text-label text-muted-foreground">Создайте пустой месяц или перенесите суммы прошлого месяца как черновик. Ничего не будет считаться подтверждённым автоматически.</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void start(false)} disabled={put.isPending}>Начать пустой месяц</Button>{hasPrevious ? <Button size="sm" variant="outline" onClick={() => void start(true)} disabled={copy.isPending}><Copy className="h-4 w-4" /> Скопировать прошлый</Button> : null}</div></Card>}
          <ElectricitySection workspaceId={workspaceId} homeId={home.id} meters={overview.meters.filter((meter) => meter.kind === "electricity")} onOpenMeters={() => onOpenTab?.("meters")} />
        </div>
        <MonthHistory months={months ?? []} selected={period} onSelect={choosePeriod} />
      </div>
    )}
    {showAnalytics && months?.length ? <UtilitiesAnalytics months={months} /> : null}
    {showTable && months?.length ? <HistoryTable months={months} onSelect={choosePeriod} /> : null}
    <ImportUtilityTable workspaceId={workspaceId} homeId={home.id} open={importOpen} onClose={() => setImportOpen(false)} onImported={choosePeriod} />
    <ConfirmDialog open={pendingPeriod !== null} title="Открыть другой месяц?" description="Несохранённые изменения текущего месяца будут потеряны." confirmLabel="Открыть" danger={false} onCancel={() => setPendingPeriod(null)} onConfirm={() => { if (pendingPeriod) { setPeriod(pendingPeriod); setEditorDirty(false); } setPendingPeriod(null); }} />
  </div>;
}

type DraftCharge = { id: string; name: string; amount: string; confirmed: boolean; note: string };
function MonthEditor({ month, busy, onSave, onDirtyChange }: { month: UtilityMonth; busy: boolean; onSave: (input: PutUtilityMonthInput) => Promise<unknown>; onDirtyChange: (dirty: boolean) => void }): React.ReactElement {
  const { toast } = useToast();
  const [rent, setRent] = useState(inputMoney(month.rentMinor));
  const [rentConfirmed, setRentConfirmed] = useState(month.rentConfirmed);
  const [charges, setCharges] = useState<DraftCharge[]>(month.charges.map((c) => ({ ...c, amount: inputMoney(c.amountMinor) })));
  const [dirty, setDirty] = useState(false);
  const parsedCharges = charges.map((charge) => ({ ...charge, amountMinor: parseMoney(charge.amount) }));
  const parsedRent = parseMoney(rent);
  const valid = parsedRent !== null && parsedCharges.every((charge) => charge.name.trim() && charge.amountMinor !== null) && new Set(charges.map((c) => c.id)).size === charges.length;
  const preview = valid ? utilityTotals({ rentMinor: parsedRent, rentConfirmed, charges: parsedCharges.map((row) => ({ id: row.id, name: row.name, amountMinor: row.amountMinor as number, confirmed: row.confirmed, note: row.note })) }) : null;
  function markDirty(): void { setDirty(true); onDirtyChange(true); }
  function change(id: string, patch: Partial<DraftCharge>): void { setCharges((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row)); markDirty(); }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid || parsedRent === null) { toast({ title: "Проверьте суммы и названия компаний", tone: "danger" }); return; }
    const input: PutUtilityMonthInput = { expectedRevision: month.revision, rentMinor: parsedRent, rentConfirmed, charges: parsedCharges.map((row) => ({ id: row.id, name: row.name.trim(), amountMinor: row.amountMinor as number, confirmed: row.confirmed, note: row.note })) };
    try { await onSave(input); setDirty(false); onDirtyChange(false); toast({ title: "Месяц сохранён", tone: "success" }); }
    catch (error) { toast({ title: "Не удалось сохранить", description: String(error), tone: "danger" }); }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-4">
    <div className="grid gap-2 [@container(min-width:700px)]:grid-cols-3">
      <Metric label="Коммуналка" value={preview ? money(preview.utilityMinor) : "—"} />
      <Metric label="Квартирная плата" value={parsedRent !== null ? money(parsedRent) : "—"} />
      <Metric label="Общий итог · черновик + счета" value={preview ? money(preview.grandTotalMinor) : "—"} strong />
    </div>
    {month.importedUtilityMinor !== null || month.importedGrandTotalMinor !== null ? <p className="rounded-lg border border-border/70 p-3 text-2xs text-muted-foreground">В исходной таблице: коммуналка {month.importedUtilityMinor === null ? "—" : money(month.importedUtilityMinor)}, итог {month.importedGrandTotalMinor === null ? "—" : money(month.importedGrandTotalMinor)}.{month.importedUtilityMinor !== null && preview && month.importedUtilityMinor !== preview.utilityMinor || month.importedGrandTotalMinor !== null && preview && month.importedGrandTotalMinor !== preview.grandTotalMinor ? <span className="ml-1 text-warning">Есть расхождение с текущими строками — проверьте суммы.</span> : null}</p> : null}
    <Card className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-title">Счета компаний</h4><span className="text-2xs text-muted-foreground">Подтверждено: {preview ? money(preview.confirmedUtilityMinor) : "—"}</span></div>
      {charges.length === 0 ? <p className="text-label text-subtle-foreground">Добавьте компанию и сумму из её счёта.</p> : null}
      <div className="space-y-2">{charges.map((charge) => <div key={charge.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 p-2">
        <label className="min-w-[9rem] flex-1"><span className="sr-only">Компания</span><Input value={charge.name} onChange={(e) => change(charge.id, { name: e.target.value, confirmed: false })} placeholder="Компания" aria-label="Компания" /></label>
        <label className="w-28"><span className="sr-only">Сумма, ₽</span><Input value={charge.amount} onChange={(e) => change(charge.id, { amount: e.target.value, confirmed: false })} inputMode="decimal" aria-label={`Сумма: ${charge.name || "компания"}`} /></label>
        <label className="flex items-center gap-1 text-2xs text-muted-foreground"><input type="checkbox" checked={charge.confirmed} onChange={(e) => change(charge.id, { confirmed: e.target.checked })} /> Счёт получен</label>
        <button type="button" aria-label={`Убрать ${charge.name || "строку"}`} onClick={() => { setCharges((rows) => rows.filter((r) => r.id !== charge.id)); markDirty(); }} className="rounded p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
      </div>)}</div>
      <Button type="button" size="sm" variant="outline" onClick={() => { setCharges((rows) => [...rows, { id: crypto.randomUUID(), name: "", amount: "0,00", confirmed: false, note: "" }]); markDirty(); }}><Plus className="h-4 w-4" /> Компания</Button>
    </Card>
    <Card className="space-y-3 p-4"><h4 className="text-title">Квартирная плата</h4><div className="flex flex-wrap items-center gap-3"><label className="w-40"><span className="mb-1 block text-2xs text-muted-foreground">За этот месяц, ₽</span><Input value={rent} inputMode="decimal" onChange={(e) => { setRent(e.target.value); setRentConfirmed(false); markDirty(); }} /></label><label className="mt-4 flex items-center gap-1 text-2xs text-muted-foreground"><input type="checkbox" checked={rentConfirmed} onChange={(e) => { setRentConfirmed(e.target.checked); markDirty(); }} /> Сумма подтверждена</label></div><p className="text-2xs text-subtle-foreground">Изменение здесь не перепишет прошлые месяцы.</p></Card>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-2xs text-muted-foreground">Это начисления, не списания денег. Оплату записывайте в «Финансах».</p><Button type="submit" size="sm" disabled={!dirty || !valid || busy}><Save className="h-4 w-4" /> Сохранить месяц</Button></div>
  </form>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): React.ReactElement {
  return <Card className={`p-4 ${strong ? "border-accent/40 bg-accent/5" : ""}`}><span className="block text-2xs text-muted-foreground">{label}</span><strong className="mt-2 block text-xl font-semibold tabular-nums">{value}</strong></Card>;
}

function MonthHistory({ months, selected, onSelect }: { months: UtilityMonth[]; selected: string; onSelect: (period: string) => void }): React.ReactElement {
  return <Card className="self-start p-3"><h4 className="px-2 py-1 text-label font-semibold">История месяцев</h4>{months.length === 0 ? <p className="px-2 py-3 text-2xs text-muted-foreground">История появится после первого месяца.</p> : <div className="max-h-[36rem] space-y-1 overflow-auto">{months.map((month) => <button key={month.id} type="button" onClick={() => onSelect(month.period)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/5 ${selected === month.period ? "bg-accent/15" : ""}`}><span className="min-w-0"><span className="block text-label">{labelPeriod(month.period)}</span><span className="block text-2xs text-muted-foreground">{allConfirmed(month) ? "Все суммы подтверждены" : "Есть черновики"}</span></span><span className="shrink-0 text-label tabular-nums">{money(month.grandTotalMinor)}</span></button>)}</div>}</Card>;
}

function HistoryTable({ months, onSelect }: { months: UtilityMonth[]; onSelect: (period: string) => void }): React.ReactElement {
  const suppliers = [...new Set(months.flatMap((month) => month.charges.map((charge) => charge.name)))];
  return <Card className="overflow-hidden p-0"><div className="border-b border-border p-4"><h4 className="text-title">Начисления по месяцам</h4><p className="text-2xs text-muted-foreground">Нажмите на месяц, чтобы открыть его счета и оплату. Таблица прокручивается по горизонтали.</p></div><div className="overflow-x-auto"><table className="w-full min-w-max text-left text-2xs"><thead className="bg-white/5 text-muted-foreground"><tr><th className="sticky left-0 bg-card p-3">Месяц</th>{suppliers.map((supplier) => <th key={supplier} className="p-3 font-medium">{supplier}</th>)}<th className="p-3">Коммуналка</th><th className="p-3">Квартплата</th><th className="p-3">Итого</th><th className="p-3">Оплачено</th></tr></thead><tbody>{months.map((month) => <tr key={month.id} className="border-t border-border/60 hover:bg-white/5"><td className="sticky left-0 bg-card p-3"><button type="button" onClick={() => onSelect(month.period)} className="font-medium text-accent hover:underline">{labelPeriod(month.period)}</button></td>{suppliers.map((supplier) => <td key={supplier} className="p-3 text-right tabular-nums">{month.charges.filter((charge) => charge.name === supplier).map((charge) => money(charge.amountMinor)).join(" + ") || "—"}</td>)}<td className="p-3 text-right tabular-nums">{money(month.utilityMinor)}</td><td className="p-3 text-right tabular-nums">{money(month.rentMinor)}</td><td className="p-3 text-right font-semibold tabular-nums">{money(month.grandTotalMinor)}</td><td className="p-3 text-right tabular-nums">{month.paidMinor === null ? "—" : money(month.paidMinor)}</td></tr>)}</tbody></table></div></Card>;
}

function ElectricitySection({ workspaceId, homeId, meters, onOpenMeters }: { workspaceId: string | undefined; homeId: string; meters: Meter[]; onOpenMeters: () => void }): React.ReactElement {
  return <Card className="space-y-4 p-4"><div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-muted-foreground" aria-hidden /><h4 className="text-title">Калькулятор электричества</h4></div><QuickElectricityCalculator />{meters.length === 0 ? <div className="border-t border-border/70 pt-3"><p className="text-2xs text-muted-foreground">Чтобы хранить показания и тарифы, добавьте электросчётчик.</p><Button className="mt-2" size="sm" variant="outline" onClick={onOpenMeters}>Открыть счётчики</Button></div> : meters.map((meter) => <ElectricityMeter key={meter.id} workspaceId={workspaceId} homeId={homeId} meter={meter} />)}</Card>;
}

function QuickElectricityCalculator(): React.ReactElement {
  const [previous, setPrevious] = useState("");
  const [current, setCurrent] = useState("");
  const [tariff, setTariff] = useState("");
  const [amount, setAmount] = useState("");
  const [daysElapsed, setDaysElapsed] = useState("");
  const [daysTotal, setDaysTotal] = useState("");
  const prev = parseDecimalInput(previous);
  const next = parseDecimalInput(current);
  const rateInput = parseRateInput(tariff);
  // A valid tariff typed in wins; otherwise the bill amount implies one. An invalid typed tariff is reported, not ignored.
  const enteredRate = rateInput.kind === "ok" ? rateInput.rateRub : "";
  const amountMinor = parseRubToMinor(amount);
  const impliedRate = rateInput.kind !== "ok" && amountMinor !== null ? electricityTariffFromAmount(prev, next, amountMinor) : null;
  const rate = enteredRate || impliedRate || "";
  const result = electricityEstimate(prev, next, rate);
  const consumed = Number.isFinite(prev) && Number.isFinite(next) && next >= prev ? Math.round((next - prev) * 1000) / 1000 : null;
  const forecast = electricityForecast(prev, next, parseWholeInput(daysElapsed), parseWholeInput(daysTotal), rate || undefined);
  const nothingTyped = !previous && !current && !tariff && !amount;
  const num = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  return (
    <div className="space-y-3">
      <p className="text-2xs text-muted-foreground">
        Введите показания на начало периода и на сейчас (или на конец). Дальше либо тариф — получите сумму, либо сумму по счёту — получите тариф. Дни периода дают прогноз расхода на конец.
      </p>
      <div className="grid gap-2 [@container(min-width:650px)]:grid-cols-2">
        <label className="text-2xs text-muted-foreground">Начало периода, кВт·ч<Input className="mt-1" value={previous} onChange={(event) => setPrevious(event.target.value)} inputMode="decimal" placeholder="Например, 1250" /></label>
        <label className="text-2xs text-muted-foreground">Сейчас / конец периода, кВт·ч<Input className="mt-1" value={current} onChange={(event) => setCurrent(event.target.value)} inputMode="decimal" placeholder="Например, 1360" /></label>
        <label className="text-2xs text-muted-foreground">Тариф, ₽/кВт·ч<Input className="mt-1" value={tariff} onChange={(event) => setTariff(event.target.value)} inputMode="decimal" placeholder="Например, 6,25" /></label>
        <label className="text-2xs text-muted-foreground">Сумма по счёту, ₽ (если тариф неизвестен)<Input className="mt-1" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Например, 687,50" /></label>
        <label className="text-2xs text-muted-foreground">Дней прошло с начала периода<Input className="mt-1" value={daysElapsed} onChange={(event) => setDaysElapsed(event.target.value)} inputMode="numeric" placeholder="Для прогноза, например 12" /></label>
        <label className="text-2xs text-muted-foreground">Дней в периоде<Input className="mt-1" value={daysTotal} onChange={(event) => setDaysTotal(event.target.value)} inputMode="numeric" placeholder="Например, 30" /></label>
      </div>
      {consumed !== null ? (
        <div className="space-y-1 rounded-lg bg-accent/10 p-3 text-label">
          <p>Расход с начала периода: <strong>{num(consumed)} кВт·ч</strong></p>
          {impliedRate ? <p>Тариф по счёту: <strong>{Number(impliedRate).toLocaleString("ru-RU", { maximumFractionDigits: 4 })} ₽/кВт·ч</strong></p> : null}
          {result && enteredRate ? <p>К оплате примерно: <strong>{money(result.amountMinor)}</strong></p> : null}
          {forecast ? (
            <p>
              На конец периода: <strong>{num(forecast.projected)} кВт·ч</strong>, показание ≈ <strong>{num(forecast.projectedEndReading)}</strong>
              {forecast.projectedAmountMinor !== null ? <>, сумма ≈ <strong>{money(forecast.projectedAmountMinor)}</strong></> : null}
            </p>
          ) : null}
        </div>
      ) : nothingTyped ? null : (
        <p className="text-2xs text-warning">Введите показания числами; на конец периода показание не меньше, чем на начало.</p>
      )}
      {consumed !== null && rateInput.kind !== "ok" && amountMinor === null && amount.trim() ? <p className="text-2xs text-warning">Сумма — число рублей, например 687,50.</p> : null}
      {rateInput.kind === "invalid" ? <p className="text-2xs text-warning">Тариф — положительное число рублей за кВт·ч, например 6,25. Пока он неверный, расчёт по нему не делается.</p> : null}
      {(daysElapsed.trim() || daysTotal.trim()) && consumed !== null && !forecast ? <p className="text-2xs text-warning">Для прогноза укажите целые дни: прошло — от 1, в периоде — не меньше прошедших.</p> : null}
    </div>
  );
}

function ElectricityMeter({ workspaceId, homeId, meter }: { workspaceId: string | undefined; homeId: string; meter: Meter }): React.ReactElement {
  const { toast } = useToast();
  const { data: tariffs, isError, refetch } = useElectricityTariffs(workspaceId, homeId, meter.id);
  const addTariff = useAddElectricityTariff(workspaceId, homeId, meter.id);
  const addReading = useAddMeterReading(workspaceId);
  const [newReading, setNewReading] = useState("");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(localToday);
  const currentTariff = tariffs?.find((item) => item.effectiveFrom <= localToday());
  const next = parseDecimalInput(newReading);
  const estimate = meter.lastValue !== null && newReading.trim() ? electricityEstimate(meter.lastValue, next, currentTariff?.rateRub ?? "") : null;
  // Recording a reading must not depend on having a tariff: the estimate is optional.
  const readingOk = canRecordReading(meter.lastValue, newReading);
  const consumption = readingOk && meter.lastValue !== null ? Math.round((next - meter.lastValue) * 1000) / 1000 : null;
  const changedDuringPeriod = Boolean(currentTariff && meter.lastReadAt && currentTariff.effectiveFrom > meter.lastReadAt.slice(0, 10));
  async function saveTariff(event: FormEvent): Promise<void> {
    event.preventDefault();
    try { await addTariff.mutateAsync({ effectiveFrom: from, rateRub: rate.trim().replace(",", "."), note: "" }); setRate(""); toast({ title: "Тариф сохранён", tone: "success" }); }
    catch (error) { toast({ title: "Не удалось сохранить тариф", description: String(error), tone: "danger" }); }
  }
  async function saveReading(): Promise<void> {
    if (!readingOk) return;
    try { await addReading.mutateAsync({ homeId, meterId: meter.id, input: { value: next, note: "" } }); setNewReading(""); toast({ title: "Показание записано", tone: "success" }); }
    catch (error) { toast({ title: "Показание не записано", description: String(error), tone: "danger" }); }
  }
  return <div className="space-y-3 border-t border-border pt-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-label">{meter.name}</strong><span className="text-2xs text-muted-foreground">{currentTariff ? `${Number(currentTariff.rateRub).toLocaleString("ru-RU", { maximumFractionDigits: 4 })} ₽/кВт·ч с ${currentTariff.effectiveFrom}` : "Тариф не задан"}</span></div>
    {isError ? <Button size="sm" variant="outline" onClick={() => void refetch()}>Повторить загрузку тарифа</Button> : null}
    <div className="grid gap-2 [@container(min-width:650px)]:grid-cols-[1fr_1fr_auto]"><label className="text-2xs text-muted-foreground">Предыдущее показание<Input value={meter.lastValue === null ? "Нет" : String(meter.lastValue)} readOnly className="mt-1" /></label><label className="text-2xs text-muted-foreground">Новое показание<Input value={newReading} inputMode="decimal" onChange={(e) => setNewReading(e.target.value)} placeholder="кВт·ч" className="mt-1" /></label><div className="self-end"><Button size="sm" onClick={() => void saveReading()} disabled={!readingOk || addReading.isPending}>Записать</Button></div></div>
    {meter.lastValue === null ? <p className="text-2xs text-muted-foreground">Сначала запишите начальное показание на вкладке «Счётчики».</p> : consumption !== null ? <div className="flex flex-wrap items-baseline gap-3 rounded-lg bg-accent/10 p-3"><span className="text-label">Расход: <b>{consumption} кВт·ч</b></span>{estimate ? <span className="text-label">Оценка: <b>{money(estimate.amountMinor)}</b></span> : <span className="text-2xs text-muted-foreground">Задайте тариф, чтобы увидеть оценку суммы.</span>}</div> : <p className="text-2xs text-muted-foreground">Введите новое показание. Если оно меньше предыдущего, проверьте замену прибора.</p>}
    {changedDuringPeriod ? <p className="text-2xs text-warning">Тариф изменился после прошлого показания. Без показания на дату изменения это только приблизительная оценка.</p> : null}
    <form onSubmit={(e) => void saveTariff(e)} className="flex flex-wrap items-end gap-2 border-t border-border/70 pt-3"><label className="min-w-36 flex-1 text-2xs text-muted-foreground">Тариф, ₽/кВт·ч<Input className="mt-1" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Например, 6,25" /></label><label className="text-2xs text-muted-foreground">Действует с<Input className="mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><Button type="submit" size="sm" variant="outline" disabled={!rate.trim() || addTariff.isPending}><Check className="h-4 w-4" /> Сохранить тариф</Button></form>
    <p className="text-2xs text-subtle-foreground">Оценка по расходу не равна сумме квитанции: в ней могут быть дополнительные начисления и корректировки.</p>
  </div>;
}
